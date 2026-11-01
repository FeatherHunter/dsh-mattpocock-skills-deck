// shared/version-control/src/branch-ticket.ts —— 域 4（分支与标签）的预检票据口径（#1746 T11 返工）
//
// 为什么要有这一片：分支与标签的写动作和改动页、提交页一样，必须是「先预检、拿一张 120 秒的票、
//   凭票执行」三段式（规格第 8 节、方案第 4 节主缝 B）。预检与执行之间隔着用户点确认的那几秒，
//   这几秒里仓库仍可被终端里的命令改动；票只管「预检那一刻看到的事实」，执行前必须逐格重算比对。
//
// 这一片只放纯逻辑：动作清单、参数规范化、票据比对的输入字节。本文件保持零 import 自包含，理由是真话：
//   shared 层内**新增**同层 import 会被依赖门禁的存量清单拦下（.dependency-cruiser.ts 的
//   same-layer-import-shared 只许减不许增），而门禁要能把这一片单独求值——直接拿这份源码拼出函数，
//   不必先解析一张依赖图。changes-protocol.ts:14-15 的 import 是清单里已有的存量，不是照着加的意思。
//   稳定序列化（branchStableValue）与 write-ticket.ts 的 canonicalJson 是同一算法的两份拷贝，跨票复制是
//   刻意的：票据模块之间互相 import 会让一张票的改动牵动另一张票。一致性由
//   tests/verify-1586-write-contracts.ts 逐字节守，改一处必须同步改另一处。
//   哈希与起进程都在宿主做（node:crypto 与 runGit 由宿主注入），这里只决定「取哪一份字节」。
//
// 与 write-ticket.ts 的分工：那张票的通用形状（makeTicket / bindingsVerdict / ticketPureVerdict /
//   requestIdProblem）在 write-ticket.ts；这一片补的是分支域自己的动作表与「哪些参数算同一件事」。

/** 九个写动作对应的账本能力号（capability-ledger.ts 域 4）：预检按它查 minVersion 与降级做法。
 *  这里只放编号不 import 账本——本文件零 import 自包含，账本条目由调用方查好之后写进计划。 */
export const BRANCH_OP_CAP_IDS: any = { create: '4.2', switch: '4.3', detach: '4.4', rename: '4.5', delete: '4.6', upstream: '4.7', 'tag-create': '4.10', 'tag-delete': '4.11', describe: '4.13' }

/** 域 4 九个写动作（4.12 验签是只读，不在这张表里，走预检电话直接执行）。顺序与界面动作表一致。 */
export const BRANCH_TICKET_OPS: string[] = ['create', 'switch', 'detach', 'rename', 'delete', 'upstream', 'tag-create', 'tag-delete', 'describe']

/** 只读动作：4.12 验签不改仓库，不签票，但仍走同一条预检电话（界面只有一条入口）。 */
export const BRANCH_TICKET_READ_OP = 'verify'

/** 预检回包契约名与版本：界面与门禁据此判断「这是新协议的票」而不是旧版 dryRun 回包。 */
export const BRANCH_CHECK_CONTRACT = 'version-control.branch-check'
export const BRANCH_CHECK_VERSION = 1

/** 把任意值写成稳定字符串：对象键排序、undefined 当 null、数组保序。
 *  预检与执行各算一遍再比相等，只有同一口径才能比；直接 JSON.stringify 会因键顺序不同误判。
 *  这份实现与另外四份由 tests/verify-1586-write-contracts.ts 的 C 组逐字节比对：改一处必须五份一起改。 */
export function branchStableValue(value: any): string {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number') return isFinite(value) ? String(value) : 'null'
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(branchStableValue).join(',') + ']'
  if (t === 'object') {
    const keys: string[] = Object.keys(value).filter(function (k: string) { return value[k] !== undefined }).sort()
    return '{' + keys.map(function (k: string) { return JSON.stringify(k) + ':' + branchStableValue(value[k]) }).join(',') + '}'
  }
  return 'null'
}

/** 动作参数规范化：只留下这个动作真正会用到的字段，并把空值统一成 null/空串。
 *  写层执行时只用这张规范化后的计划（客户端再送一遍参数也不采信），所以这里必须把「同一件事」的
 *  等价写法收敛掉：未给与空串都算同一个值，force 一律布尔，unset 由 upstream 字段是否为空推出。 */
export function branchPlanOf(op: string, args: any): { ok: true; plan: any } | { ok: false; reason: string; message: string } {
  const a: any = args || {}
  const s = function (v: any): string { return v === undefined || v === null ? '' : String(v) }
  const want: string = String(op || '')
  if (BRANCH_TICKET_OPS.indexOf(want) < 0) return { ok: false, reason: 'bad-target', message: '不认识的分支写动作：' + want + '（允许：' + BRANCH_TICKET_OPS.join(' / ') + '）' }
  if (want === 'create') return { ok: true, plan: { op: want, name: s(a.name), from: s(a.from) === '' ? null : s(a.from) } }
  if (want === 'switch') return { ok: true, plan: { op: want, name: s(a.name) } }
  if (want === 'detach') return { ok: true, plan: { op: want, rev: s(a.rev) } }
  if (want === 'rename') return { ok: true, plan: { op: want, from: s(a.from), to: s(a.to) } }
  if (want === 'delete') return { ok: true, plan: { op: want, name: s(a.name), force: a.force === true } }
  if (want === 'upstream') return { ok: true, plan: { op: want, branch: s(a.branch), upstream: a.unset === true ? null : s(a.upstream), unset: a.unset === true } }
  if (want === 'tag-create') return { ok: true, plan: { op: want, name: s(a.name), mode: s(a.mode) === '' ? 'light' : s(a.mode), target: s(a.target) === '' ? null : s(a.target), message: s(a.message) } }
  if (want === 'tag-delete') return { ok: true, plan: { op: want, name: s(a.name) } }
  return { ok: true, plan: { op: want, branch: s(a.branch), text: s(a.text) } }
}

/** 计划这一格要哈希的字节：规范化后的计划整份。参数变了（例如把要删的分支名换掉）自然判成 target-changed。 */
export function branchPlanDigestInput(plan: any): string {
  return branchStableValue(plan || null)
}

/** 工作区这一格要哈希的字节：暂存/未暂存条数、冲突数、四个中途操作标记。
 *  分支切换与删除都要看「工作区脏不脏、有没有停在合并里」，这些在预检后变化同样必须拒。 */
export function branchWorktreeInput(screen: any): string {
  const s: any = screen || {}
  const repo: any = s.repo || {}
  return branchStableValue({
    staged: typeof s.stagedCount === 'number' ? s.stagedCount : (Array.isArray(s.staged) ? s.staged.length : 0),
    unstaged: typeof s.unstagedCount === 'number' ? s.unstagedCount : (Array.isArray(s.unstaged) ? s.unstaged.length : 0),
    conflicts: typeof s.conflictCount === 'number' ? s.conflictCount : 0,
    merging: repo.merging === true, rebasing: repo.rebasing === true,
    cherryPicking: repo.cherryPicking === true, reverting: repo.reverting === true,
  })
}

/** 配置这一格要哈希的字节：上游远端名 + 上游分支引用，或分支说明旧值，用 NUL 分开（两个值都可能为空，不能用空格拼）。 */
export function branchConfigInput(remote: any, merge: any): string {
  return String(remote === undefined || remote === null ? '' : remote) + '\u0000' + String(merge === undefined || merge === null ? '' : merge)
}

/** 预检结果里给界面看的现场摘要（block 时也要回现场，界面才知道「为什么不能点」）：只放人眼需要的那几样。 */
export function branchSceneSummary(scene: any): any {
  const s: any = scene || {}
  return {
    current: s.current === undefined || s.current === null ? null : String(s.current),
    dirty: s.dirty === true,
    conflicts: s.conflicts === true,
    midOperation: s.midOperation === true,
    targetOid: s.targetOid === undefined || s.targetOid === null ? null : String(s.targetOid),
    descriptionOld: s.descriptionOld === undefined || s.descriptionOld === null ? null : String(s.descriptionOld),
    upstreamOld: s.upstreamOld === undefined || s.upstreamOld === null ? null : String(s.upstreamOld),
  }
}

export const BRANCH_TICKET_SOURCE = 'src/shared/version-control/src/branch-ticket.ts'
