/**
 * src/client/views/versionControl/vcStashOps.ts —— 贮藏页的数据与动作层（#1751 T16，规格 #1586 域 7）
 *
 * 职责只三件：把首屏聚合里的贮藏片与版本片读成页面能用的形状；把「哪条动作要不要确认、
 * 电话参数怎么拼」翻译成一次 wf.gitStash 调用；把回包落成页面状态。画法在 vcStashPage.ts，
 * 条目与校验规则在共享层 stash-rules.ts（由构建拼进同一个闭包，不重复说一遍）。
 *
 * 界面绝不自己判断版本：能不能用 7.3 的 --staged 由共享层按 git 版本算，
 * 版本读不到时按「藏起来」处理——宁可少一个按钮，也不给点了就报错的按钮。
 */

// 共享层 stash-rules.ts 由构建拼进同一个闭包（shared:vcStashRules 标记）；这里只声明形状。
// 类型检查按单文件跑，跨叶子的名字一律先声明，不 import（客户端半边没有运行时 import）。
declare const STASH_OPS: any[]
declare const STASH_STAGED_MIN_VERSION: string
declare function stashOpOf(op: any): any
declare function vcStashOpVersionStateOf(op: any, versionText: any): string

/** 贮藏页唯一的宿主电话：十条动作（加上列表刷新与丢弃恢复）都走这一条。 */
export const VC_STASH_PHONE = 'wf.gitStash'
/** 首屏聚合里贮藏数据所在的分片名（与 first-screen.ts 的契约同一份）。 */
export const VC_STASH_SLICE = 'stashes'
/** 只贮藏已暂存的文件：唯一带版本门的动作（2.35，规格第 6 节）。 */
export const VC_STASH_STAGED_OP = 'push-staged'
/** 贮藏写动作的预检电话：危险与非危险的写动作都先签一张 120 秒票，凭票才执行（规格第 63 / 385 行的三段式）。 */
export const VC_STASH_CHECK_PHONE = 'wf.gitStashCheck'
/** 需要预检票的写动作：读动作（list / show）与最近丢弃的恢复直接执行，其余一律先预检再确认再凭票执行。 */
export const VC_STASH_CHECK_OPS: string[] = ['push', 'push-untracked', 'push-staged', 'apply', 'pop', 'branch', 'drop', 'clear']

/** 贮藏页的初始状态：列表与最近丢弃都空，等首屏数据或动作回包填。 */
export const vcStashStateNew = function (): any {
  return {
    entries: [],
    listState: 'idle',
    versionText: '',
    message: '',
    detail: null,
    pending: null,
    confirm: null,
    branch: null,
    result: null,
    recent: [],
  }
}

/** 首屏聚合里的贮藏条目；数据没到或是坏分片时给空数组（页面照常画得出空列表）。 */
export const vcStashEntriesOf = function (reads: any): any[] {
  const slices = reads && reads.slices ? reads.slices : {}
  const slice = slices[VC_STASH_SLICE] || null
  const data = slice && slice.state === 'ok' ? slice.data : null
  return data && Array.isArray(data.entries) ? data.entries : []
}

/** 贮藏分片的读取状态：ok / err / load-fail / idle，页面按它决定画列表还是画错误。 */
export const vcStashListStateOf = function (reads: any): string {
  const slices = reads && reads.slices ? reads.slices : {}
  const slice = slices[VC_STASH_SLICE] || null
  if (!slice) return 'idle'
  if (slice.state === 'ok') return 'ok'
  if (slice.state === 'load-fail') return 'load-fail'
  return 'err'
}

/** 首屏版本片里的 git 版本串（界面只用来查词条与版本门，不自己解析版本号）。 */
export const vcStashVersionTextOf = function (reads: any): string {
  const slices = reads && reads.slices ? reads.slices : {}
  const slice = slices.version || null
  const data = slice && slice.state === 'ok' ? slice.data : null
  return data && typeof data.gitVersion === 'string' ? data.gitVersion : ''
}

/** 7.3 的版本门：full 可点；hidden 不画按钮，换成规格给的替代做法。 */
export const vcStashStagedStateOf = function (versionText: any): any {
  const state = vcStashOpVersionStateOf(VC_STASH_STAGED_OP, versionText)
  return { state: state, needed: STASH_STAGED_MIN_VERSION, alternativeKey: 'vc.stash.gate.alternative' }
}

/** 一条动作在这个版本上是否该画出来（hidden 的动作一个按钮都不留，命令面板另有替代路径）。 */
export const vcStashOpVisibleOf = function (op: any, versionText: any): boolean {
  return vcStashOpVersionStateOf(op, versionText) !== 'hidden'
}

/** 这条动作要不要确认卡：账本里「毁」档的 drop / clear 两条。 */
export const vcStashNeedsConfirmOf = function (op: any): boolean {
  const def: any = stashOpOf(op)
  return !!(def && def.danger)
}

/** 要确认时把对象级信息一并带上：确认卡贴触发点，说清删哪一条。 */
export const vcStashConfirmOf = function (op: any, entry: any): any {
  if (!vcStashNeedsConfirmOf(op)) return null
  const one = entry || {}
  return { op: String(op || ''), selector: String(one.selector || ''), subject: String(one.subject || '') }
}

/** 确认卡点「确认」时给这次调用的参数：只有确认过的危险动作才允许 confirm:true。 */
export const vcStashConfirmPayloadOf = function (confirm: any): any {
  if (!confirm || !confirm.op) return null
  return { op: String(confirm.op), selector: String(confirm.selector || ''), confirm: true }
}

/** 把一次用户动作翻成电话参数；selector / message / branch 只带真正给的键。 */
export const vcStashActionPayloadOf = function (input: any): any {
  const i = input || {}
  const out: any = { op: String(i.op || '') }
  if (i.selector !== undefined && i.selector !== null) out.selector = String(i.selector)
  if (i.message !== undefined && i.message !== null) out.message = String(i.message)
  if (i.branch !== undefined && i.branch !== null) out.branch = String(i.branch)
  if (i.confirm === true) out.confirm = true
  return out
}

/** 这条动作要不要先签预检票：读动作与恢复不要票，写动作要。 */
export const vcStashNeedsTicketOf = function (op: any): boolean {
  return VC_STASH_CHECK_OPS.indexOf(String(op || '')) >= 0
}

/** 一次预检请求的 requestId：宿主只要求 [A-Za-z0-9_-] 且不超过 64；同一号重放不二次执行。 */
export const vcStashRequestIdOf = function (nowMs: any, salt: any): string {
  return 's' + Number(nowMs || 0).toString(36) + String(salt || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
}

/** 预检回包里的票据：只有 ok 且带回 ticket.id 才算签出，否则回 null（页面据此报错而不是硬发执行电话）。 */
export const vcStashTicketOf = function (reply: any): any {
  const ticket: any = reply && reply.ok === true ? reply.ticket : null
  return ticket && ticket.id ? ticket : null
}

/** 预检电话：与执行电话同一组参数，另外带回票据与动作计划；不执行任何写操作。 */
export const vcStashCheckCallOf = function (call: any, cwd: any, input: any): any {
  const payload = vcStashActionPayloadOf(input)
  delete payload.confirm
  payload.cwd = String(cwd || '')
  return call(VC_STASH_CHECK_PHONE, payload)
}

/** 凭票执行电话：带预检签出的 ticketId 与本次 requestId，confirmed 标明确认卡已经过目。 */
export const vcStashWriteCallOf = function (call: any, cwd: any, input: any, ticketId: any, requestId: any): any {
  const payload = vcStashActionPayloadOf(input)
  delete payload.confirm
  payload.cwd = String(cwd || '')
  if (ticketId) payload.ticketId = String(ticketId)
  if (requestId) payload.requestId = String(requestId)
  payload.confirmed = true
  return call(VC_STASH_PHONE, payload)
}

/** 预检回包落成确认卡模型：触发点就地出卡，说清哪条动作、哪一条记录，票据与请求号随状态带着走。 */
export const vcStashCheckConfirmOf = function (payload: any, reply: any, requestId: any): any {
  const p: any = payload || {}
  const ticket: any = vcStashTicketOf(reply)
  if (!ticket) return null
  const plan: any = (reply && reply.plan) || {}
  return {
    op: String(p.op || ''),
    selector: String(p.selector || ''),
    subject: String(plan.subject || p.subject || ''),
    ticketId: String(ticket.id),
    requestId: String(requestId || ''),
  }
}


/** 失败原因码到词条键的白名单：宿主回的每个 kind 都有一条人话，认不出落其他。 */
export const vcStashFailKeyOf = function (kind: any): string {
  const table: any = {
    usage: 'vc.stash.fail.usage',
    selector: 'vc.stash.fail.selector',
    branch: 'vc.stash.fail.branch',
    'branch-exists': 'vc.stash.fail.branchExists',
    'version-hidden': 'vc.stash.fail.versionHidden',
    env: 'vc.stash.fail.env',
    'not-repo': 'vc.stash.fail.notRepo',
    read: 'vc.stash.fail.read',
    'stash-missing': 'vc.stash.fail.stashMissing',
    confirm: 'vc.stash.fail.confirm',
    exit: 'vc.stash.fail.exit',
    timeout: 'vc.stash.fail.timeout',
    'spawn-failed': 'vc.stash.fail.spawn',
    cancelled: 'vc.stash.fail.cancelled',
    stale: 'vc.stash.fail.stale',
  }
  return table[String(kind || '')] || 'vc.stash.fail.other'
}

/** 回包落成一条结果摘要：动作名与失败原因都翻成词条，页面只管印。 */
export const vcStashResultOf = function (reply: any): any {
  const r = reply || {}
  const ok = r.ok === true
  return {
    ok: ok,
    op: String(r.op || ''),
    kind: ok ? '' : String((r.error && r.error.kind) || 'other'),
    needed: r.needed ? String(r.needed) : '',
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
  }
}

/** 动作回包落状态：成功刷新列表与最近丢弃；失败只留错误，不动已经读到的列表。 */
export const vcStashApplyReply = function (state: any, reply: any): any {
  const next = Object.assign({}, state || vcStashStateNew())
  const r = reply || {}
  next.pending = null
  next.confirm = null
  next.branch = null
  next.result = vcStashResultOf(r)
  if (r.ok === true) {
    if (Array.isArray(r.entries)) {
      next.entries = r.entries
      next.listState = 'ok'
    }
    if (Array.isArray(r.recent)) next.recent = r.recent
    if (r.op === 'show') {
      next.detail = {
        selector: String(r.selector || ''),
        oid: String(r.oid || ''),
        files: Array.isArray(r.files) ? r.files : [],
        fileCount: typeof r.fileCount === 'number' ? r.fileCount : 0,
        patch: typeof r.patch === 'string' ? r.patch : '',
        truncated: r.truncated === true,
      }
    }
  }
  return next
}

/** 最近丢弃条目的摘要：界面要能一眼看出丢的是哪一条、什么时候丢的。 */
export const vcStashRecentOf = function (state: any): any[] {
  const list = state && Array.isArray(state.recent) ? state.recent : []
  return list.map(function (one: any) {
    return { selector: String(one.selector || ''), oid: String(one.oid || ''), subject: String(one.subject || ''), atMs: Number(one.atMs) || 0, droppedAtMs: Number(one.droppedAtMs) || 0 }
  })
}

/** 短提交号：完整号留在 title 里，正文只印前 10 位。 */
export const vcStashShortOidOf = function (oid: any): string {
  const text = String(oid || '')
  return text.length > 10 ? text.slice(0, 10) : text
}

/** 时间印法：本地时区的「年-月-日 时:分」，不依赖 Intl（测试机与真机一致）。 */
export const vcStashWhenOf = function (atMs: any): string {
  const ms = Number(atMs)
  if (!isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  const pad = function (n: number): string { return n < 10 ? '0' + n : String(n) }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 真源标识：门禁按这一行找本文件，改路径要一起改门禁。 */
export const VC_STASH_OPS_SOURCE = 'src/client/views/versionControl/vcStashOps.ts'
