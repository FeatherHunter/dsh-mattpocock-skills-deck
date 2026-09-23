/**
 * refresh-core/src/idempotency.ts —— 创建幂等锚：锚长什么样、回查找什么、算不算命中
 *
 * 这份文件只回答三个问题，别的什么都不做：
 *   1. 一个调用方给的幂等键，落到票面上的那一行稳定标识长什么样（anchorLineFor / markerOf）；
 *   2. 从一段票面正文里怎么把那行标识认出来（idempotencyKeyOf）；
 *   3. 后端按锚找到了候选票之后，这张候选票算不算「就是它」（matchAnchor）。
 *
 * 为什么要有这一层：票据**已经建成了、只是调用方没收到回答**是真实会发生的（超时、EOF、
 * 退出码非 0 但票已经落进后端）。这种时候外层一定会重试，重试就会再建一张 —— 同一个逻辑动作
 * 在盘上、在远端各变成两张票，而两次调用都回 ok。锚解决的就是这一半：同一个锚提交两次，
 * 只多出一张票、返回同一个 key（跨进程、跨重试都成立，因为锚落在票面上，不是记在内存里）。
 *
 * 一条硬纪律：**回查不许只看内存里那张表**。内存表在进程重启、插件重载、换个会话之后就没了，
 * 而要找的那张票还在；只有从票面上把锚读回来，才算真的回查。锚因此必须是票面里的一行原文：
 *   - GitHub：正文里的 HTML 注释（渲染后看不见，读回来还是原文）；
 *   - GitLab：description 里同一行（同上）；
 *   - 本地 Markdown：票文件里同一行（文件本身就是票面）。
 *
 * 这个文件是**纯逻辑**：不读盘、不联网、不起进程。真正发请求与落盘留在 src/host/tracker/**，
 * 它只负责构造那一行、认出那一行、判断找到了算不算。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 一、锚的形状
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 锚那一行开头的固定串。三个后端写出来的是同一个形状（HTML 注释，渲染后不可见）。
 *
 * 为什么用 HTML 注释：三个后端都原样存正文，HTML 注释在 GitHub 与 GitLab 的网页上不显示，
 * 在本地 Markdown 里也只是一行普通文本；写成别的形态（零宽字符、看不见的 Unicode 间隔符）
 * 会在正文里留下不显示却真实存在的字节，日后编辑正文的人会莫名其妙。
 *
 * 后面那个 `:` 与结尾的空白都算在标记里：这样从正文里抠出键值时只需按这两个边界切一刀，
 * 不必再猜「这一行到底怎么写才算」。
 */
export const IDEMPOTENCY_MARKER_PREFIX = '<!-- DSH-IDEMPOTENCY-KEY:'

/** 一个幂等键最长多少个字符。超了就拒绝，不截断（截断会把两个不同的键撞成一个）。 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200

/**
 * 键里允许出现的字符：字母、数字、点、下划线、连字符、冒号、斜杠。
 * 这一串正好是「UUID、带时间戳的串、按命名规则拼出来的串」这些真实调用方会用的字符；
 * 其余一律拒绝 —— 键里若混进换行或 `-->`，写下去会破坏票面正文的收尾注释，读回来也对不上。
 */
const ALLOWED_KEY_RE = /^[A-Za-z0-9._:/-]+$/

/** 幂等键检查结果。真实调用方给的键几乎总能过；不过就是这一档，不看别的。 */
export interface IdempotencyKeyCheck {
  /** 这个键能不能用。 */
  ok: boolean
  /** 能用的键（原样，只去两头空白）；不能用时是空串。 */
  key: string
  /** 不能用时的一句大白话原因；能用时是空串。 */
  reason: string
}

/**
 * 检查一个幂等键能不能落到票面上。
 *
 * 判据只有三条：非空、不超长、字符都在允许范围内。为什么不在这一层「清洗」它（把非法字符换掉）：
 * 换掉之后写下去的键与调用方手里那个不是同一个串，第二次提交算不算「同一个锚」就成了运气问题；
 * 宁可当场拒绝，让调用方换一个键。
 */
export function checkIdempotencyKey(raw: unknown): IdempotencyKeyCheck {
  const key = raw === null || raw === undefined ? '' : String(raw).trim()
  if (!key) return { ok: false, key: '', reason: '幂等键是空的' }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return { ok: false, key: '', reason: '幂等键有 ' + key.length + ' 个字符，超过上限 ' + IDEMPOTENCY_KEY_MAX_LENGTH + '，请换一个短一点的键' }
  }
  if (!ALLOWED_KEY_RE.test(key)) {
    return { ok: false, key: '', reason: '幂等键里只能有字母、数字、点、下划线、连字符、冒号与斜杠（键会原样写进票面，换行与注释收尾符会把正文写坏）' }
  }
  return { ok: true, key, reason: '' }
}

/**
 * 这一行就是票面上的锚，含两头的换行。正文里带上它，票面上就多出这一行（渲染后看不见）。
 *
 * 返回值结尾带一个换行：直接拼在正文开头就是一个独立成行的注释；
 * 后端要判断「这张票是不是已经写过锚」时，两边都是同一份拼接结果，不会一边有换行一边没有。
 */
export function anchorLineFor(key: string): string {
  return IDEMPOTENCY_MARKER_PREFIX + ' ' + key + ' -->\n'
}

/**
 * 从一段正文里把锚那一行认出来（找到是哪一个键，找不到返回空串）。
 *
 * 认法就是「某一行去掉两头空白之后，以标记开头、以注释收尾结束」：按行找，行内不再做模糊匹配。
 * 为什么不做模糊匹配（例如全篇搜 `DSH-IDEMPOTENCY-KEY` 再往后取一串）：正文是用户会手改的东西，
 * 有人在正文里提到这个标记的名字时，模糊匹配会把他提到的那个名字当成锚，回查就会指向一张不相干的票。
 */
export function idempotencyKeyOf(text: unknown): string {
  const body = String(text === null || text === undefined ? '' : text)
  if (!body || body.indexOf(IDEMPOTENCY_MARKER_PREFIX) < 0) return ''
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')
    if (trimmed.indexOf(IDEMPOTENCY_MARKER_PREFIX) !== 0) continue
    if (!/-->$/.test(trimmed)) continue
    const key = trimmed.slice(IDEMPOTENCY_MARKER_PREFIX.length, trimmed.length - 3).trim()
    if (key) return key
  }
  return ''
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、回查命中要满足什么条件
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 候选票身上的那一行（只留这几个字段，别的一个都不要）。
 * 后端按锚找到候选之后，把它们交进 matchAnchor，由这里判断算不算命中 —— 判断只有一处，
 * 三个后端不许各自实现一遍。
 */
export interface AnchorCandidate {
  /** 后端里这张票的身份（GitHub 是票号串，GitLab 是 iid 串，本地是票文件里的编号）。 */
  key: string
  /** 这张票的正文原文（GitHub 与 GitLab 是正文，本地是票文件全文）。用来把锚读回来。 */
  body: string
  /** 这张票是不是还开着。省略 = 不知道（后端没取到状态时如实省略，不猜）。 */
  state?: 'open' | 'closed'
  /** 这张票是谁的仓库（多仓库后端用得上；省略 = 这次只在一个仓库里找）。 */
  refId?: string
}

/** 回查结论：命中（复用候选）、没命中（没有候选）、回查不成立（如实报错，不猜）。 */
export type AnchorMatchStatus = 'hit' | 'miss' | 'mismatch' | 'unsupported'

/** 回查结论的完整结果：结论 + 一句给人看的原因 + 命中时把那张票的 key 带回来。 */
export interface AnchorMatch {
  status: AnchorMatchStatus
  reason: string
  /** 只有 status==='hit' 时有值：命中的那张票的 key（也就是本次调用要返回的 key）。 */
  key?: string
  /** status==='hit' 时，回查是否跨过了「这个仓库」以外的地方（今天恒为 false，留给多仓库后端）。 */
  crossRepo?: boolean
}

/** 「没命中」是一个正常的结论（这张票确实还没建），不是错误。 */
export function anchorMiss(reason?: string): AnchorMatch {
  return { status: 'miss', reason: reason || '按锚找遍了，没有找到写过这个锚的票' }
}

/**
 * 「回查做不成」这一档：如实说出来，绝不假装成「没找到」。
 *
 * 为什么这一档要单独存在：如果某个后端的回查接口拿不全（分页没翻完、搜索接口报错、
 * 目录读不出来），把结果当成「没找到」就会再建一张票 —— 那正是这张票要防的事，
 * 而且是在「看起来成功了」的外表下发生的。所以这一档必须一路冒到调用方。
 */
export function anchorUnsupported(reason: string): AnchorMatch {
  return { status: 'unsupported', reason }
}

/** 「有候选，但它身上的锚不是这一个」这一档：如实说，绝不复用（复用会把不相干的票当成你的票）。 */
export function anchorMismatch(reason: string): AnchorMatch {
  return { status: 'mismatch', reason }
}

/** 「就是它」这一档。 */
export function anchorHit(key: string): AnchorMatch {
  return { status: 'hit', reason: '这张票的票面上写着同一个锚，复用它（不再新建）', key: String(key) }
}

/**
 * 回查命中要满足什么条件（判据只有这一处，三个后端共用）。
 *
 * 三条，按顺序：
 *   1. 候选票的正文里必须真的写着这个锚 —— 后端说「我按锚找到了」不算数，锚得能从票面上读回来。
 *      为什么把这一条放在最前面：内存里那张表、搜索接口的模糊命中、文件名里的近似串，
 *      都可能交来一个「看起来像」的候选；唯一站得住的证据是票面原文里有这一行。
 *   2. 候选票的仓库必须是同一个仓库（后端带 refId 时才比）。同一个锚在两个仓库里各有一张票时，
 *      复用错的那张等于把另一张票的谱系接到这次动作上。
 *   3. 候选票必须还开着。已经关闭的票不算命中 —— 一个锚对应一件要做完的事，
 *      它已经做完了还拿旧 key 回来的话，调用方要的是「这件事现在怎么样了」，
 *      不是「把这次新建悄悄吞掉」。这时按「没命中」处理：再建一张，并且由调用方自己去查旧票。
 *
 * 找不到候选是 miss；有新候选但锚对不上是 mismatch；拿不准是哪一种时按 unsupported 报。
 */
export function matchAnchor(candidates: AnchorCandidate[] | unknown, refId: string | undefined, key: string): AnchorMatch {
  const list = Array.isArray(candidates) ? candidates : []
  const wanted = String(key === null || key === undefined ? '' : key).trim()
  if (!wanted) return anchorUnsupported('没有给锚，无从回查')
  if (list.length === 0) return anchorMiss()
  const mismatches: string[] = []
  for (let i = 0; i < list.length; i++) {
    const c = list[i] as AnchorCandidate | null | undefined
    if (!c || typeof c !== 'object') { mismatches.push('第 ' + (i + 1) + ' 个候选不是一张票，忽略'); continue }
    const found = idempotencyKeyOf(c.body)
    if (!found) { mismatches.push('候选 ' + String(c.key) + ' 的票面上没有锚那一行'); continue }
    if (found !== wanted) { mismatches.push('候选 ' + String(c.key) + ' 的票面上写的是另一个锚（' + found + '）'); continue }
    if (refId !== undefined && c.refId !== undefined && String(c.refId) !== String(refId)) {
      mismatches.push('候选 ' + String(c.key) + ' 在另一个仓库（' + String(c.refId) + '）里')
      continue
    }
    if (c.state === 'closed') { mismatches.push('候选 ' + String(c.key) + ' 已经关闭了，不算命中（该建一张新的）'); continue }
    return anchorHit(String(c.key))
  }
  return anchorMismatch(mismatches.join('；'))
}

/** 这份回查结论是不是「找到了、可以复用」。后端据此决定是返回旧 key 还是继续建票。 */
export function isAnchorHit(m: AnchorMatch | null | undefined): boolean {
  return !!(m && m.status === 'hit')
}

/** 这份回查结论是不是「回查做不成」这一档（后端据此如实失败，不许当成没找到）。 */
export function isAnchorUnsupported(m: AnchorMatch | null | undefined): boolean {
  return !!(m && m.status === 'unsupported')
}

/** 回查失败时给调用方看的那句话：说清是哪一种不成立，以及插件没有因此多建票。 */
export function describeAnchorFailure(m: AnchorMatch): string {
  const why = m && typeof m.reason === 'string' && m.reason ? m.reason : '回查没有做成'
  return '这次带锚创建没能做成回查，所以没有建票：' + why + '。这不是「已经建过」的意思 —— 请换用不带锚的创建，或者先把锚回查这一条修好再来。'
}

// 这里原来有一行 `export const IDEMPOTENCY_SOURCE = 'refresh-core/src/idempotency.ts'`。#719 把它删掉：
// 全仓没有任何代码读它，而产物第一行的 AUTO-GENERATED 包头（由 refresh-core/build.mjs 按真实文件名
// 生成）已经把「这份 JS 从哪来」写清楚了——手写一份同样的字符串只可能漂移。
// 空壳产物（refresh-core/src/ports.ts）不一样：它的产物里只剩那一行标识，所以 PORTS_SOURCE 留着。
