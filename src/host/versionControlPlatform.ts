// src/host/versionControlPlatform.ts —— 平台段 14.1「生成补丁邮件」的两条电话（#1762 T26）
//
// 这里只有 14.1 这一条写动作：预检（check）签一张 120 秒的票据，执行（run）凭票据把命令交给
// #1740 的长任务通道。它自己不起进程 —— 真正的 git 进程由父文件注入的 startTask 走长任务通道
// 起（命令拼装、非交互环境、-C 钉仓库、输出增量读都在那一边），所以「写动作三段式」的
// 预检 / 确认语义在这里，执行语义与取消在任务通道。
//
// 约定（改了会坏的地方）：
//   1) 参数校验只用共享层 task-protocol 的 taskArgsFor('format-patch', ...)：宿主执行前与界面
//      预检读同一份「区间 / 输出目录」守卫，不在这里写第二份。相对目录在签票前先换成绝对路径，
//      票里存的是绝对目录，执行时不会因为任务通道换了工作目录而落到别处。
//   2) 票据只负责「预检新鲜度」：120 秒过期、仓库根变了、HEAD 变了都拒绝；过期不自动重放，
//      要用户重新预检（规格第 4 节并发与票据）。
//   3) 失败信封统一 {ok:false, error:{kind, reason, message, hint}}，reason 用 write-reasons
//      里的稳定标识，界面拿它去同一张词表取禁用 / 失败原因，不自己编话。
//   4) requestId 去重靠任务通道自己的 requestId / 在途去重；这里只校验格式并在缺省时生成一个。

import { taskArgsFor } from '../shared/version-control/src/task-protocol.js'
import { makeTicket, ticketPureVerdict, ticketVerdict, requestIdProblem } from '../shared/version-control/src/write-ticket.js'
import { writeHintFor } from '../shared/version-control/src/write-reasons.js'

/** 14.1 的动作名：票据 op、任务 op 与 dedupe key 都用这一个字符串，不各写一份。 */
export const VC_PLATFORM_PATCH_OP: any = 'format-patch'

/** 一张票只活 120 秒；票据表最多留 200 张（与改动页同一口径）。 */
const TICKETS_MAX: number = 200

const joinRepo = function (root: any, rel: any): string {
  return String(root === undefined || root === null ? '' : root).replace(/[\\/]+$/, '') + '/' + String(rel === undefined || rel === null ? '' : rel).replace(/^[\\/]+/, '')
}

const isAbsolutePath = function (p: any): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(String(p === undefined || p === null ? '' : p))
}

export function createPlatformTicketPhones(deps: any): any {
  const failPhone: any = deps.failPhone
  const readScreenOf: any = deps.readScreenOf
  const startTask: any = deps.startTask
  const nowMs: any = typeof deps.now === 'function' ? deps.now : Date.now
  const randomId: any = typeof deps.randomId === 'function' ? deps.randomId : function (): string { return Math.random().toString(36).slice(2) }
  const DEFAULT_CWD: any = deps.DEFAULT_CWD
  const tickets: Map<string, any> = new Map()

  function fail(kind: string, reason: string, message: string, extra?: any): any {
    return { ok: false, error: { kind: kind, reason: reason, message: message, hint: writeHintFor(reason) } }
  }

  function screenOf(cwd: any): Promise<any> {
    return Promise.resolve(readScreenOf(cwd)).then(function (r: any): any { return r })
  }

  /** 预检：签票。票里钉住仓库根、HEAD、区间与绝对输出目录。 */
  async function check(args: any): Promise<any> {
    const a: any = args && typeof args === 'object' ? args : {}
    const cwd: any = typeof a.cwd === 'string' && a.cwd.length > 0 ? a.cwd : DEFAULT_CWD
    const range: string = String(a.range === undefined || a.range === null ? '' : a.range).trim()
    const dirIn: string = String(a.dir === undefined || a.dir === null ? 'patches' : a.dir).trim() || 'patches'
    const built: any = taskArgsFor(VC_PLATFORM_PATCH_OP, { range: range, dir: dirIn })
    if (!built.ok) return fail('args', built.reason, built.message)
    const screenReply: any = await screenOf(cwd)
    if (!screenReply || screenReply.ok !== true || !screenReply.data) return screenReply && screenReply.ok === false ? screenReply : fail('shape', 'shape', '首屏读数缺字段，没法确认仓库状态')
    const screen: any = screenReply.data.screen || screenReply.data
    if (!screen || !screen.identity) return fail('shape', 'shape', '首屏读数里没有工作区身份，没法签票')
    if (screen.repo && screen.repo.bare === true) return fail('other', 'repo-bare', '裸仓库里没有工作区，不能导出补丁')
    const root: string = String(screen.identity.worktreePath || '')
    if (root === '') return fail('shape', 'shape', '首屏读数里没有工作区路径，没法签票')
    const dirAbs: string = isAbsolutePath(dirIn) ? dirIn : joinRepo(root, dirIn)
    const rebuilt: any = taskArgsFor(VC_PLATFORM_PATCH_OP, { range: range, dir: dirAbs })
    if (!rebuilt.ok) return fail('args', rebuilt.reason, rebuilt.message)
    const ticket: any = makeTicket({
      id: 'fp-' + String(randomId()),
      op: VC_PLATFORM_PATCH_OP,
      nowMs: nowMs(),
      headOid: String(screen.identity.oid || ''),
      indexFingerprint: '',
      indexEntries: 0,
      target: null,
      repoRoot: root,
      changes: { op: VC_PLATFORM_PATCH_OP, range: range, dir: dirIn, dirAbs: dirAbs } as any,
    })
    tickets.set(ticket.id, ticket)
    if (tickets.size > TICKETS_MAX) tickets.delete(tickets.keys().next().value as string)
    return {
      ok: true,
      decision: { verdict: 'allow', reasons: [] },
      plan: { op: VC_PLATFORM_PATCH_OP, range: range, dir: dirIn, dirAbs: dirAbs, args: rebuilt.args },
      confirmRequired: true,
      ticket: { id: ticket.id, checkedAtMs: ticket.checkedAtMs, expiresAtMs: ticket.expiresAtMs, op: ticket.op },
      readAtMs: nowMs(),
    }
  }

  /** 执行：凭票把任务交给长任务通道；票过期、仓库变了、参数被改都拒绝，绝不自动重放。 */
  async function run(args: any): Promise<any> {
    const a: any = args && typeof args === 'object' ? args : {}
    const cwd: any = typeof a.cwd === 'string' && a.cwd.length > 0 ? a.cwd : DEFAULT_CWD
    const ticketId: string = String(a.ticketId === undefined || a.ticketId === null ? '' : a.ticketId)
    const ticket: any = tickets.get(ticketId)
    const pure: any = ticketPureVerdict(ticket, VC_PLATFORM_PATCH_OP, nowMs())
    if (pure && pure.ok !== true) return fail('ticket', pure.reason, '预检票据不能用：' + pure.reason)
    const range: string = String(a.range === undefined || a.range === null ? '' : a.range).trim()
    const dirIn: string = String(a.dir === undefined || a.dir === null ? '' : a.dir).trim()
    const dirAbs: string = dirIn === '' ? String(ticket.changes.dirAbs) : (isAbsolutePath(dirIn) ? dirIn : joinRepo(ticket.repoRoot, dirIn))
    if (range !== ticket.changes.range || dirAbs !== ticket.changes.dirAbs) return fail('args', 'target-changed', '参数和票据里的不一样（区间或输出目录变了），重新预检')
    const screenReply: any = await screenOf(cwd)
    if (!screenReply || screenReply.ok !== true) return screenReply || fail('shape', 'shape', '首屏读数缺字段，没法复核现场')
    const screen: any = screenReply.data.screen || screenReply.data
    const current: any = { op: VC_PLATFORM_PATCH_OP, repoRoot: String(screen.identity.worktreePath || ''), headOid: String(screen.identity.oid || ''), indexEntries: 0, indexFingerprint: '' }
    const stale: any = ticketVerdict(ticket, nowMs(), current)
    if (stale && stale.ok !== true) return fail('stale', stale.reason, '仓库现场变了（' + stale.reason + '），重新预检后再生成')
    let requestId: string = String(a.requestId === undefined || a.requestId === null ? '' : a.requestId)
    if (requestId === '') requestId = 'fp-' + String(randomId())
    const ridProblem: any = requestIdProblem(requestId)
    if (ridProblem) return fail('args', ridProblem, '请求编号不合法：' + ridProblem)
    const reply: any = await Promise.resolve(startTask({ op: VC_PLATFORM_PATCH_OP, args: { range: ticket.changes.range, dir: ticket.changes.dirAbs }, cwd: current.repoRoot, requestId: requestId }))
    if (!reply || reply.ok !== true) return reply && reply.error ? reply : fail('other', 'unknown-write-failure', '长任务通道没有接受这次生成请求')
    return { ok: true, task: reply.task || null, reused: reply.reused === true, ticketId: ticketId, requestId: requestId, dir: ticket.changes.dirAbs, range: ticket.changes.range }
  }

  return { check: check, run: run, tickets: tickets }
}
