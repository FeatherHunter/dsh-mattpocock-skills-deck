// host/versionControlSubmodules.ts —— 域 10（子模块）的读数电话 wf.gitSubmodules（#1757 T21）
//
// 这一片只做只读：跑两条固定的 git 命令（submodule status --recursive、config -f .gitmodules），
// 再给每个已初始化的子模块补三格现场（当前分支、本地提交数、能不能吸收 .git），拼成界面行。
// 不写任何东西，也不起写命令——写动作走预检/执行两条电话，吸收 .git 也不例外。
//
// 约定（改了会坏的地方）：
//   1) 界面行由共享层 submoduleRowsOf 拼：状态行与配置行按 path 对齐，不在这里另造一份行模型。
//   2) 逐个子模块的补充读取失败只让那一格缺省，不整包失败：一个坏掉的子模块不该让整页读不出来。
//   3) .gitmodules 不存在时 git config 的退出码是 1，这是「还没登记过子模块」，不是失败。
//   4) 地址只把抹过口令的 urlDisplay 交给界面；原文留在预检签票那一刻的内存里，供执行用一次。
import { submoduleStatusArgs, submoduleConfigArgs, submoduleParseStatus, submoduleParseConfig,
  submoduleRowsOf, SUBMODULE_BOARD_CONTRACT, SUBMODULE_BOARD_VERSION } from '../shared/version-control/src/submodule-ops.js'
import { VC_SUBMODULE_READ_TIMEOUT_MS as READ_TIMEOUT_MS } from '../shared/time-config/src/values.js'

const STDOUT_LIMIT: number = 8 * 1024 * 1024

/** 拼绝对路径：只把尾部/头部的斜杠收拾掉，其余原样（Windows 与 POSIX 都能喂给 node 的文件接口）。 */
function joinPath(root: any, rel: any): string {
  const base: string = String(root === undefined || root === null ? '' : root).replace(/[\\/]+$/, '')
  const tail: string = String(rel === undefined || rel === null ? '' : rel).replace(/^[\\/]+/, '')
  return base + '/' + tail
}

/** 取一条命令输出的第一行：git 的逐行结果只在这里用，完整输出不进日志也不进回包。 */
function shortText(text: any): string {
  const s: string = String(text === undefined || text === null ? '' : text)
  const i: number = s.indexOf('\n')
  return (i < 0 ? s : s.slice(0, i)).trim()
}

/** 造读数器：返回 { boardOf(exe, root, gitDir) }。宿主电话与预检叶子共用这一份读法，不各写一套。 */
export function createSubmoduleBoardReader(deps: any): any {
  const d: any = deps || {}
  const runPinned: any = d.runPinned
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const failPhone: any = d.failPhone
  const firstLine: any = d.firstLine
  const failureFromExec: any = d.failureFromExec
  const READ_OPTS: any = { stdoutLimit: STDOUT_LIMIT, timeoutMs: READ_TIMEOUT_MS }

  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return failPhone(kind, message, Object.assign({ reason: reason }, extra || {}))
  }
  function gitSays(res: any): string {
    const text: string = String((res && res.stderr) || '').trim() !== '' ? firstLine(res.stderr) : firstLine(res && res.stdout)
    return String(text).slice(0, 400)
  }
  /** 读一条只读命令：起进程失败/超时/读不全都显式失败；非零退出交给调用方决定（submodule 读法里有退出码 1 的正常场景）。 */
  async function readOut(exe: any, root: any, what: string, args: string[], allowNonZero?: boolean): Promise<any> {
    const res: any = await runPinned(exe, root, args, READ_OPTS)
    const bad: any = res.kind === 'ok' || (allowNonZero && res.kind === 'non-zero') ? null : failureFromExec(res, what)
    if (bad) return { ok: false, envelope: bad }
    if (res.truncated) return { ok: false, envelope: fail('truncated', 'truncated', what + '的输出超过了字节上限，读不全就不给半份数据') }
    return { ok: true, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode }
  }
  async function baseOf(cwd: any): Promise<any> {
    const exe: any = await resolveGitExecutable()
    if (!exe) return { fail: fail('env', 'env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）') }
    const base: any = await resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return { fail: base }
    return { exe: exe, root: base.root, gitDir: base.gitDir }
  }
  /** 逐个子模块的补充事实：读不到哪格就缺哪格，绝不让一个坏子模块拖垮整页。 */
  async function factsOf(exe: any, root: any, gitDir: any, row: any): Promise<any> {
    const dir: string = joinPath(root, row.path)
    const head: any = await readOut(exe, dir, '读子模块当前分支这一步', ['rev-parse', '--abbrev-ref', 'HEAD'], true)
    const headText: string = head.ok === true ? shortText(head.stdout) : ''
    const detached: boolean = headText === 'HEAD' || headText === ''
    const count: any = await readOut(exe, dir, '算子模块本地提交数这一步', ['rev-list', '--count', 'HEAD', '--not', '--branches'], true)
    let localCommits: number = 0
    if (count.ok === true) { const n: number = parseInt(shortText(count.stdout), 10); localCommits = isFinite(n) && n > 0 ? n : 0 }
    const gd: any = await readOut(exe, dir, '读子模块 git 目录这一步', ['rev-parse', '--git-dir'], true)
    const gdText: string = gd.ok === true ? shortText(gd.stdout) : ''
    // 老式克隆把 .git 放成子模块目录里的真目录（路径以 /.git 结尾）；新版把 .git 写成文件、实体放
    // 父仓库的 .git/modules 下。只有前者还需要吸收，后者再跑吸收动作是空操作。
    const absorbable: boolean = gdText !== '' && /[\\/]\.git$/.test(gdText.replace(/[\\/]+$/, ''))
    return {
      headBranch: headText,
      detached: detached,
      localCommits: localCommits,
      absorbable: absorbable,
      absorbFrom: absorbable ? gdText.replace(/\\/g, '/') : '',
      absorbTo: absorbable ? joinPath(gitDir, 'modules/' + (row.name || row.path)) : '',
    }
  }
  /** 读一块完整现场：状态行 + 登记行 + 逐行补充事实。任何一步真失败就整包失败，不给半份数据。 */
  async function boardOf(exe: any, root: any, gitDir: any): Promise<any> {
    const statusRes: any = await readOut(exe, root, '读子模块清单这一步', submoduleStatusArgs())
    if (statusRes.ok !== true) return { ok: false, envelope: statusRes.envelope }
    const parsed: any = submoduleParseStatus(statusRes.stdout)
    if (parsed.ok !== true) return { ok: false, envelope: fail('parse', 'parse', '子模块清单解析失败：' + String(parsed.detail || '')) }
    const configRes: any = await readOut(exe, root, '读子模块登记这一步', submoduleConfigArgs(), true)
    if (configRes.ok !== true) return { ok: false, envelope: configRes.envelope }
    let modules: any[] = []
    const exitCode: any = configRes.exitCode
    if (typeof exitCode === 'number' && exitCode !== 0) {
      // 退出码 1 = 没有 .gitmodules（还没登记过子模块），这是正常空态；其它非零才是真失败。
      if (exitCode !== 1) {
        const said: string = gitSays({ kind: 'non-zero', exitCode: exitCode, stderr: configRes.stderr })
        return { ok: false, envelope: fail('git-failed', 'other', '读子模块登记这一步失败：git 原话「' + said + '」', { git: said, step: '读子模块登记这一步', expected: '退出码 0，或 1（还没登记过子模块）', actual: '退出码 ' + exitCode, cause: 'git config -f .gitmodules --get-regexp 返回了非零' }) }
      }
    } else {
      const pc: any = submoduleParseConfig(configRes.stdout)
      if (pc.ok !== true) return { ok: false, envelope: fail('parse', 'parse', '子模块登记解析失败：' + String(pc.detail || '')) }
      modules = pc.modules
    }
    const facts: any = {}
    for (const row of parsed.rows) {
      if (!row || row.state === 'uninitialized') continue
      facts[row.path] = await factsOf(exe, root, gitDir, row)
    }
    return { ok: true, rows: submoduleRowsOf(parsed.rows, modules, facts) }
  }
  return { boardOf: boardOf }
}

/** 造读数电话 wf.gitSubmodules：一次回整块现场（行 + 计数）。 */
export function createSubmodulePhones(deps: any): any {
  const d: any = deps || {}
  const reader: any = createSubmoduleBoardReader(d)
  const resolveGitExecutable: any = d.resolveGitExecutable
  const resolveRepoRoot: any = d.resolveRepoRoot
  const failPhone: any = d.failPhone
  const cwdOf: any = d.cwdOf
  const nowFn: any = (typeof d.now === 'function') ? d.now : Date.now

  async function handleGitSubmodules(args: any): Promise<any> {
    const cwd: string = typeof cwdOf === 'function' ? cwdOf(args) : ''
    const exe: any = await resolveGitExecutable()
    if (!exe) return failPhone('env', '找不到 git 命令（platform.resolveExecutable("git") 没有给出路径）')
    const base: any = await resolveRepoRoot(exe, cwd)
    if (!base || base.ok !== true) return base
    const board: any = await reader.boardOf(exe, base.root, base.gitDir)
    if (board.ok !== true) return board.envelope
    const rows: any[] = board.rows
    let initialized: number = 0
    let uninitialized: number = 0
    let detached: number = 0
    let absorbable: number = 0
    let localCommits: number = 0
    for (const row of rows) {
      if (row.initialized === true) initialized += 1
      else uninitialized += 1
      if (row.initialized === true && row.detached === true) detached += 1
      if (row.absorbable === true) absorbable += 1
      localCommits += row.localCommits || 0
    }
    return {
      ok: true,
      contract: SUBMODULE_BOARD_CONTRACT,
      version: SUBMODULE_BOARD_VERSION,
      readAtMs: nowFn(),
      rows: rows,
      counts: { total: rows.length, initialized: initialized, uninitialized: uninitialized, detached: detached, absorbable: absorbable, localCommits: localCommits },
    }
  }
  return { handleGitSubmodules: handleGitSubmodules }
}

export const SUBMODULE_READ_SOURCE = 'src/host/versionControlSubmodules.ts'
