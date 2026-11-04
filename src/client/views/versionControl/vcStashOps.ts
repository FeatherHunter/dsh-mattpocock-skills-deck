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

/** 一屏里自动读「查看内容」的条数上限（#1860 D8）：再往后由人点，避免几十条记录同时起 git 进程。 */
export const VC_STASH_AUTO_SHOW_MAX = 10
/** 详情缓存的条数上限：与差异缓存同一档（40 份），超出的按首次写入顺序丢最旧的。 */
export const VC_STASH_DETAIL_MAX = 40

/** 贮藏页的初始状态：列表与最近丢弃都空，等首屏数据或动作回包填。
 *  details 是「选择器 → 那一卷的详情读数」：D8 起记录行一挂出来就自动读前十条，所以详情不再只有一份；
 *  每份带 state（loading / ok / err），界面据此画「正在读」「读失败带重试」还是文件清单。 */
export const vcStashStateNew = function (): any {
  return {
    entries: [],
    listState: 'idle',
    versionText: '',
    message: '',
    details: {},
    pending: null,
    confirm: null,
    branch: null,
    result: null,
    recent: [],
  }
}

/** 一条记录的详情读数；没有就是 null（界面据此画「点查看内容才给」）。 */
export const vcStashDetailOf = function (state: any, selector: any): any {
  const map: any = (state && state.details) || {}
  return map[String(selector || '')] || null
}

/** 把一条记录标成「正在读」或「读失败」：写在 details 里，界面不用另存一份在途表。
 *  patch 传 null 表示删掉这条详情（收起文件清单），其余字段原样合并。 */
export const vcStashDetailPatch = function (state: any, selector: any, patch: any): any {
  const base: any = state || vcStashStateNew()
  const key: string = String(selector || '')
  if (key === '') return base
  const map: any = Object.assign({}, base.details || {})
  if (patch === null) delete map[key]
  else map[key] = Object.assign({}, map[key] || {}, patch || {})
  const keys: string[] = Object.keys(map)
  const keep: any = keys.length <= VC_STASH_DETAIL_MAX ? map : (function () {
    const out: any = {}
    keys.slice(keys.length - VC_STASH_DETAIL_MAX).forEach(function (k: string) { out[k] = map[k] })
    return out
  })()
  return Object.assign({}, base, { details: keep })
}


/** 自动读详情的排队执行（#1860 D8）：一条一条串着发，不并发十枪。
 *  为什么串行：每条 git stash show 在宿主那边要起两个进程（文件名清单 + 差异），十条一起发会让面板
 *  一打开就卡住；串行读回来的顺序也与列表顺序一致，不会出现「后读的先铺开」。
 *  为什么先标 loading：界面立刻有反馈，而且重复调用（re-render 后再次进入）看到 loading 就不会重发。
 *  deps：selectors（要读的选择器）、call（宿主电话口）、cwd、getUi（读当前 ui）、setUi（落 ui）。 */
export const vcStashAutoRunOf = function (deps: any): any {
  const d: any = deps || {}
  const list: string[] = (Array.isArray(d.selectors) ? d.selectors : [])
    .map(function (s: any) { return String(s === undefined || s === null ? '' : s) })
    .filter(function (s: string) { return s !== '' })
  // 每次落状态都按「拿当前态算出下一态」回写（与容器其它动作层同一写法）：
  //   这十条是一条链上的微任务，中间不会等 React 重渲染完，用渲染时抓的那份 ui 会互相覆盖（#1860 D8 实测过）。
  const apply = function (fn: any): void {
    if (typeof d.setUi !== 'function') return
    d.setUi(function (cur: any) {
      const base: any = Object.assign({}, vcStashStateNew(), (cur || {}).stash || {})
      return Object.assign({}, cur || {}, { stash: fn(base) })
    })
  }
  // #1860 D18：先把这一批**全部**标成「正在读」—— 十条的骨架同时出现，然后读一条填一条。
  //   只在轮到某条时才标 loading 的话，后面的行还停在「点查看内容才给」，看起来像根本没动。
  if (list.length > 0) {
    apply(function (base: any) {
      return list.reduce(function (acc: any, s: string): any {
        return vcStashDetailPatch(acc, s, { selector: s, state: 'loading' })
      }, base)
    })
  }
  const one = function (selector: string): any {
    return Promise.resolve(vcStashWriteCallOf(d.call, d.cwd, { op: 'show', selector: selector }, '', '')).then(function (reply: any) {
      apply(function (base: any) { return vcStashApplyReply(base, reply, { quiet: true, selector: selector }) })
      return reply
    }, function (err: any) {
      // 电话本身被拒（宿主没接这一枪）也要落成「读失败」：不然这一行会一直转圈，人以为还在读。
      apply(function (base: any) {
        return vcStashDetailPatch(base, selector, { selector: selector, state: 'err', kind: 'throw', message: String((err && err.message) || err) })
      })
      return null
    })
  }
  return list.reduce(function (chain: any, selector: string): any {
    return chain.then(function () { return one(selector) })
  }, Promise.resolve(null))
}
/** 进入贮藏页时算「这一次该自动读哪几条」并交给调用方（#1860 D8）。
 *  为什么要有这一层：React 每次重渲染都会再问一次「还有谁没读」，而排队读是异步的 —— ``seen`` 记着已经请求过
 *  的选择器，不记的话同一条会被反复排队。返回这一次真正交出去的那几条（空数组表示不用做事）。 */
export const vcStashAutoKickOf = function (deps: any): string[] {
  const d: any = deps || {}
  const seen: any = d.seen || {}
  const fresh: string[] = vcStashAutoShowOf(d.state, d.entries, d.max).filter(function (s: string) { return seen[s] !== true })
  if (fresh.length === 0) return []
  fresh.forEach(function (s: string) { seen[s] = true })
  if (typeof d.fire === 'function') d.fire(fresh)
  return fresh
}

/** 自动读的名单：最新的一批记录里，还没有详情读数的那些（已读、正在读、读失败都不再自动重发）。
 *  排序与正文同一口径（按 atMs 从新到旧），只取前 max 条 —— 一屏之外的不预读。 */
export const vcStashAutoShowOf = function (state: any, entries: any, max: any): string[] {
  const list: any[] = Array.isArray(entries) ? entries.slice() : []
  const limit: number = Math.max(0, Math.floor(Number(max === undefined ? VC_STASH_AUTO_SHOW_MAX : max) || 0))
  const known: any = (state && state.details) || {}
  const sorted: any[] = list.sort(function (a: any, b: any) { return (Number(b && b.atMs) || 0) - (Number(a && a.atMs) || 0) })
  const out: string[] = []
  for (let i = 0; i < sorted.length && i < limit; i += 1) {
    const selector: string = String((sorted[i] && sorted[i].selector) || '')
    if (selector === '' || known[selector]) continue
    out.push(selector)
  }
  return out
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

/** 动作回包落状态：成功刷新列表与最近丢弃；失败只留错误，不动已经读到的列表。
 *  opts.quiet（#1860 D8 的自动读取用）：只落详情读数，不写结果条、不动 pending —— 十条记录同时读时
 *  每一条都往页顶报「查看内容完成」会盖掉真正该看的提示，也会把行上的按钮闪成不可点。 */
export const vcStashApplyReply = function (state: any, reply: any, opts?: any): any {
  const next = Object.assign({}, state || vcStashStateNew())
  const r = reply || {}
  const quiet = !!(opts && opts.quiet === true)
  const asked: string = String((opts && opts.selector) || '')
  if (!quiet) {
    next.pending = null
    next.confirm = null
    next.branch = null
    next.result = vcStashResultOf(r)
  }
  if (r.op === 'show' || asked !== '') {
    const selector: string = String(r.selector || asked || '')
    if (r.ok === true) {
      const detail: any = {
        selector: selector,
        oid: String(r.oid || ''),
        files: Array.isArray(r.files) ? r.files : [],
        fileCount: typeof r.fileCount === 'number' ? r.fileCount : 0,
        patch: typeof r.patch === 'string' ? r.patch : '',
        truncated: r.truncated === true,
        state: 'ok',
      }
      return vcStashDetailPatch(next, selector, detail)
    }
    // 读失败：把这条记成 err，界面上那颗重试才有落点；别把已经读到的那一份冲掉。
    return vcStashDetailPatch(next, selector, { selector: selector, state: 'err', kind: String((r.error && r.error.kind) || 'other') })
  }
  if (r.ok === true) {
    if (Array.isArray(r.entries)) {
      next.entries = r.entries
      next.listState = 'ok'
    }
    if (Array.isArray(r.recent)) next.recent = r.recent
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
