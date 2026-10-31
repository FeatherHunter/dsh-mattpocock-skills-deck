/**
 * src/host/versionControlStash.ts —— 贮藏十条（域 7）的宿主执行层（#1751 T16，规格 #1586 域 7）
 *
 * 为什么单独一层：版本管理宿主装配文件 versionControl.ts 已经很大，本票只许追加；十条动作
 * 又互相关联（建分支前后要校验名字、丢完要刷新列表、丢弃要留「最近丢弃」），凑成一层叶子
 * 比往父文件里再塞两百行清楚。同层禁止静态互引，所以这里不直接 import 父文件，进程出口、
 * 仓库根解析与失败信封都由父文件显式传进来（createStashPhones(deps)）。
 *
 * 「最近丢弃」只活在这个进程的内存里：规格第 3.6 节要的是把 git 自己打印的提交号留下来、
 * 在失败重试前能 store 回去，不额外造本地引用，也不跨进程持久化；进程重启后 git 还在
 * refs/stash 里的记录照样读得到，丢完的记录本来就只靠 reflog，交给 git 自己的期限。
 *
 * 一条电话 wf.gitStash 收全部动作：动作短名与命令拼装都在共享层 stash-rules.ts 一处，
 * 这里只负责「先校验、再执行、失败回信封、成功回列表」四件事，不重写任何命令规则。
 */
import { failPhone, firstLine, failureFromExec } from '../shared/version-control/exec-envelope.js'
import { checkRefArgs, stashListArgs } from '../shared/version-control/src/commands.js'
import { parseStashList } from '../shared/version-control/src/parse-stash.js'
import { capabilityAvailability } from '../shared/version-control/src/capabilities.js'
import {
  STASH_OPS,
  STASH_RECENT_MAX,
  STASH_VERSION_FLOOR,
  stashOpOf,
  stashOperationArgs,
  stashRestoreArgs,
  vcStashSelectorOk,
} from '../shared/version-control/src/stash-rules.js'

/** 一条贮藏记录：选择器、提交号、时间、说明（与 parse-stash.ts 的解析结果同一形状）。 */
interface StashEntry {
  selector: string
  oid: string
  atMs: number
  subject: string
}

/** 「最近丢弃」里的一条：多记一个丢弃时间与触发动作，恢复时把提交号原样还回去。 */
interface DroppedEntry extends StashEntry {
  droppedAtMs: number
  byOp: string
}

/**
 * 造出贮藏电话的处理器：deps 由 versionControl.ts 注入，字段都是父文件已有的能力，
 * 叶子不自己再建一份进程出口、也不自己解析仓库根。
 */
export function createStashPhones(deps: any): { handle: (args: any) => Promise<any> } {
  const runPinned = deps.runPinned
  const resolveGitExecutable = deps.resolveGitExecutable
  const resolveRepoRoot = deps.resolveRepoRoot
  const timeoutMs = Number(deps.timeoutMs) || 30000
  const stdoutLimit = Number(deps.stdoutLimit) || 8 * 1024 * 1024
  const patchLimit = Number(deps.patchLimit) || 4 * 1024 * 1024
  // 「最近丢弃」：只在本进程内记，最多 STASH_RECENT_MAX 条，新的在前。
  const recent: DroppedEntry[] = []
  const nowMs = function (): number {
    return typeof deps.nowMs === 'function' ? Number(deps.nowMs()) : Date.now()
  }

  /** 读一次贮藏列表；失败回信封，成功回 { ok:true, entries }。 */
  const readEntries = async function (exe: string, root: string): Promise<any> {
    const res = await runPinned(exe, root, stashListArgs(), { timeoutMs: timeoutMs, stdoutLimit: stdoutLimit })
    const failure = failureFromExec(res, '读贮藏列表')
    if (failure) return failure
    const parsed = parseStashList(res.stdout)
    if (!parsed.ok) {
      return failPhone('read', '贮藏列表读不出来：' + String(parsed.detail || parsed.error || '格式不对'))
    }
    return { ok: true, entries: parsed.entries || [] }
  }

  /** 成功回包的公共部分：动作、时间、刷新后的列表与「最近丢弃」。 */
  const okReply = function (op: string, entries: StashEntry[], extra: any): any {
    const reply: any = { ok: true, op: op, atMs: nowMs(), entries: entries, recent: recent.slice(0), stderr: '' }
    if (extra) Object.assign(reply, extra)
    return reply
  }

  /** 把新丢弃的几条记进「最近丢弃」：新的在前，超过上限从尾部丢（旧的交给 git 自己的回收期）。 */
  const rememberDropped = function (dropped: StashEntry[], byOp: string): void {
    const at = nowMs()
    for (let i = dropped.length - 1; i >= 0; i -= 1) {
      const one = dropped[i]
      recent.unshift({ selector: one.selector, oid: one.oid, atMs: one.atMs, subject: one.subject, droppedAtMs: at, byOp: byOp })
    }
    while (recent.length > STASH_RECENT_MAX) recent.pop()
  }

  /** 丢弃类动作执行前的名册：drop 只认当前存在的那一条；clear 记下全部。 */
  const droppedOf = function (op: string, before: StashEntry[], selector: string): StashEntry[] {
    if (op !== 'drop') return before.slice(0)
    return before.filter(function (one: StashEntry) { return one.selector === selector })
  }

  /** 版本门：只有登记了版本策略的动作才去读 git 版本（当前只有 7.3 的 2.35 门）。 */
  const versionGateOf = async function (exe: string, root: string, def: any, op: string): Promise<any> {
    const floor: string = String(def.minVersion || STASH_VERSION_FLOOR)
    if (!def.versionPolicy && (floor === STASH_VERSION_FLOOR || floor === '2.11')) return null
    const res = await runPinned(exe, root, ['--version'], { timeoutMs: timeoutMs, stdoutLimit: 64 * 1024 })
    const failure = failureFromExec(res, '读 git 版本')
    if (failure) return failure
    const versionText = String(res.stdout || '').trim()
    const avail = capabilityAvailability(
      { minVersion: def.minVersion, versionPolicy: def.versionPolicy, versionAlternative: def.versionAlternativeKey ? 'gate' : null },
      versionText
    )
    if (avail.state === 'full') return null
    return failPhone('version-hidden', '这条动作要 git ' + String(avail.needed || def.minVersion) + ' 及以上；当前是 ' + (versionText || '未知版本') + '。', {
      op: op,
      needed: avail.needed,
      gitVersion: versionText,
    })
  }

  /** 建分支前的两道校验：名字合法（交给 git 的 check-ref-format 判）与名字不存在（本地分支）。 */
  const branchGateOf = async function (exe: string, root: string, branch: string): Promise<any> {
    const check = await runPinned(exe, root, checkRefArgs(branch), { timeoutMs: timeoutMs, stdoutLimit: 64 * 1024 })
    if (check.kind === 'non-zero') return failPhone('branch', '分支名不合法：' + branch, { branch: branch })
    if (check.kind !== 'ok') {
      const failure = failureFromExec(check, '检查分支名')
      if (failure) return failure
      return failPhone('branch', '检查分支名失败：' + branch, { branch: branch })
    }
    const lookup = await runPinned(exe, root, ['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], { timeoutMs: timeoutMs, stdoutLimit: 64 * 1024 })
    if (lookup.kind === 'ok') return failPhone('branch-exists', '这个分支名已经存在：' + branch, { branch: branch })
    if (lookup.kind === 'non-zero' && Number(lookup.exitCode) === 1) return null
    const failure = failureFromExec(lookup, '检查分支是否存在')
    if (failure) return failure
    return failPhone('branch-exists', '这个分支名已经存在：' + branch, { branch: branch })
  }

  /** 查看贮藏内容：先取涉及的文件名（界面要显示文件数），再取完整差异。 */
  const showOne = async function (exe: string, root: string, selector: string, entry: StashEntry): Promise<any> {
    const names = await runPinned(exe, root, ['stash', 'show', '--name-only', selector], { timeoutMs: timeoutMs, stdoutLimit: stdoutLimit })
    const nameFailure = failureFromExec(names, '读贮藏涉及的文件')
    if (nameFailure) return nameFailure
    const fileList = String(names.stdout || '')
      .replace(/\r/g, '')
      .split('\n')
      .filter(function (line: string) { return line !== '' })
    const patch = await runPinned(exe, root, ['stash', 'show', '-p', selector], { timeoutMs: timeoutMs, stdoutLimit: patchLimit })
    const patchFailure = failureFromExec(patch, '读贮藏差异')
    if (patchFailure) return patchFailure
    return okReply('show', [], {
      selector: selector,
      oid: entry.oid,
      subject: entry.subject,
      files: fileList,
      fileCount: fileList.length,
      patch: String(patch.stdout || ''),
      truncated: patch.truncated === true,
    })
  }

  /** 主入口：一条电话收全十条动作，另加一组不属于十条的列表读取与「丢弃恢复」（内部路径）。 */
  const handle = async function (args: any): Promise<any> {
    const a = args || {}
    const op = String(a.op || '')
    const cwd = String(a.cwd || deps.defaultCwd || '')
    // 「恢复丢弃」不在十条里，是 drop/clear 的撤销路径，先单独认。
    const restoring = op === 'restore'
    const def = restoring ? null : stashOpOf(op)
    if (!restoring && !def) return failPhone('usage', '不认识的贮藏动作：' + op)
    if (def && def.danger && a.confirm !== true) return failPhone('confirm', '删除类动作要确认：' + op, { op: op })
    const selector = String(a.selector || '')
    if (def && def.needsSelector && !vcStashSelectorOk(selector)) return failPhone('selector', '贮藏选择器不合法：' + selector)

    let exe: any = null
    try {
      exe = await resolveGitExecutable()
    } catch (err: any) {
      exe = null
    }
    if (!exe) return failPhone('env', '找不到 git 命令，读不了贮藏记录。')
    const repo = await resolveRepoRoot(exe, cwd)
    if (!repo || repo.ok !== true) return repo && repo.error ? repo : failPhone('not-repo', '当前目录不是 git 仓库：' + cwd)
    const root = String(repo.root)

    // 恢复：把「最近丢弃」记下的提交重新挂回 refs/stash，不改本地引用以外的任何东西。
    if (restoring) {
      const built = stashRestoreArgs(a.subject, a.oid)
      if (!built.ok) {
        const why = built.error || { kind: 'oid', message: '' }
        return failPhone(why.kind, why.message || '恢复贮藏的参数不对')
      }
      const res = await runPinned(exe, root, built.args, { timeoutMs: timeoutMs, stdoutLimit: stdoutLimit })
      const failure = failureFromExec(res, '恢复丢弃的贮藏')
      if (failure) return failure
      const oid = String(a.oid || '')
      for (let i = recent.length - 1; i >= 0; i -= 1) if (recent[i].oid === oid) recent.splice(i, 1)
      const listed = await readEntries(exe, root)
      if (!listed.ok) return listed
      return okReply('restore', listed.entries, { restoredOid: oid })
    }

    const gate = def ? await versionGateOf(exe, root, def, def.op) : null
    if (gate) return gate

    // 列表：直接回当前记录；列表本身不写。
    if (def && def.op === 'list') {
      const listed = await readEntries(exe, root)
      if (!listed.ok) return listed
      return okReply('list', listed.entries, {})
    }

    // 要选择器的动作先确认这条还在（丢弃后再点同一个选择器会碰到别的记录，宁可不做也不猜）。
    let found: StashEntry | null = null
    if (def && def.needsSelector) {
      const listed = await readEntries(exe, root)
      if (!listed.ok) return listed
      const entries: StashEntry[] = listed.entries || []
      for (let i = 0; i < entries.length; i += 1) if (entries[i].selector === selector) found = entries[i]
      if (!found) return failPhone('stash-missing', '这条贮藏记录不存在（可能已经被丢弃）：' + selector, { selector: selector })
      if (def.op === 'show') return showOne(exe, root, selector, found)
    }

    if (def && def.op === 'branch') {
      const branch = String(a.branch || '')
      const branchGate = await branchGateOf(exe, root, branch)
      if (branchGate) return branchGate
    }

    const built = stashOperationArgs(def ? def.op : op, { message: a.message, selector: selector, branch: a.branch })
    if (!built.ok) {
      const why = built.error || { kind: 'usage', message: '' }
      return failPhone(why.kind, why.message, { op: op })
    }

    // 丢弃类动作先记下名册，执行成功后进「最近丢弃」；clear 是整份，drop 只记那一条。
    let before: StashEntry[] = []
    if (def && (def.op === 'drop' || def.op === 'clear')) {
      const listed = await readEntries(exe, root)
      if (!listed.ok) return listed
      before = listed.entries || []
    }

    const res = await runPinned(exe, root, built.args, { timeoutMs: timeoutMs, stdoutLimit: stdoutLimit })
    const failure = failureFromExec(res, '贮藏动作「' + (def ? def.op : op) + '」')
    if (failure) return failure

    if (def && (def.op === 'drop' || def.op === 'clear')) rememberDropped(droppedOf(def.op, before, selector), def.op)

    const listedAfter = await readEntries(exe, root)
    if (!listedAfter.ok) return listedAfter
    return okReply(def ? def.op : op, listedAfter.entries, {
      output: firstLine(res.stdout || ''),
      dropped: def && (def.op === 'drop' || def.op === 'clear') ? droppedOf(def.op, before, selector) : [],
    })
  }

  return { handle: handle }
}

/** 十条能力的编号名单：门禁据此对账账本，别处不再抄一份。 */
export const STASH_PHONE_OPS = STASH_OPS.map(function (one: any) { return one.id })
