/**
 * src/tracker/kernel/error-rules.ts —— 失败该归哪一档：全仓唯一的一张有序规则表
 *
 * ── 为什么只有这一处 ──────────────────────────────────────────────────────────
 * 决策与理由见 `docs/adr/20261014-error-classification-single-source.md`（2026-10-14 定版）。
 * 一句话：同一个判断写在四处就会漂移。2026-10 已经实测出两处给出**相反建议**的错判 ——
 * 限流回的 403 被判成「没登录」（让人白去重新登录）、DNS 的 `getaddrinfo ENOTFOUND` 被判成
 * 「找不到」（让人去核对一个根本不存在的标签）。所以判据只留这一张表：跟踪器层通用规则住这里，
 * 各后端与客户端都不再自己写词表；后端只许在自己的**前置扩展表**里写本家专有的错误码名与句式。
 *
 * ── 顺序就是判据（表从上往下试，第一条命中的就是结果）─────────────────────────
 * 顺序按「证据有多硬」排（ADR 第 2 节第 3 条）：
 *   ① fact     结构化事实：HTTP 状态码、进程退出码、errno —— 机器给的，最硬，先判
 *   ② errcode  错误码名：`ENOTFOUND` / `ECONNREFUSED` / `ENOENT` …（认词边界，不认子串）
 *   ③ phrase   专有句式：`command not found`、`rate limit exceeded`、`does not have the correct permissions` …
 *   ④ vague    含糊英文短语：`not found`（已收紧成词边界）、`unsupported`、`parse` …
 *   ⑤ fallback 兜底：一条都没命中就归「网络」—— 不与环境问题、找不到混（#124 定版）
 *
 * 两条常被踩的铁律就体现在这个顺序里：
 *   - 「本机缺工具/缺文件」必须排在「资源找不到」之前，否则命令名会被当成资源名；
 *   - 「网络不通」必须排在「找不到」之前，否则 `ENOTFOUND` 里的 `NOTFOUND` 会被 `not found` 吞掉。
 *
 * ── 每条规则自带样本（门禁据此自证）──────────────────────────────────────────
 * 每条规则都带一条 `example`：把这条样本单独喂进判档，结果必须**正好**是它声明的档位。
 * 门禁 `tests/verify-1111-error-rules.ts` 逐条跑这件事：新加规则不配样本就红；
 * 样本被排在它前面的规则抢走也红（那说明表里的顺序与注释/决策记录写的不一致）。
 * 另外两条由同一道门禁守着：表里的层次不许倒退（顺序即文档），扩展项不许与通用项同档位同模式
 * （防止第五份判据又长出来）。
 *
 * ── 判档只读事实，不去别处找文本 ─────────────────────────────────────────────
 * `ErrorFacts` 是判档唯一输入。状态码、退出码、错误码名是机器给的硬证据，
 * 不该被拍扁成一段字符串再去猜「正文里有没有 403 几个字」—— 403 的正文里不一定写着 403，
 * 写着 `not found` 的正文也不一定是 404。原文只当最后几层（句式与短语）的语料。
 */

import { ERROR_KIND } from '../contract/vocabulary.js'
import type { ErrorKind } from '../contract/identity.js'

// ─────────────────────────────────────────────────────────────────────────────
// 一、判档的输入与规则形状
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 判档的输入：这次失败留下了哪些事实。
 * `text` 是原文（多路合并后那一份），另外三个是机器给的结构化证据 —— 有就填，没有就别猜。
 */
export interface ErrorFacts {
  /** HTTP 状态码。有就填；没有就留空，不要从正文里「读出」一个（那是上一版的错因）。 */
  status?: number
  /** 进程退出码。各工具自己的约定（例如 gh 的「需要登录 = 4」）写在各自的扩展表里，通用层不认。 */
  exitCode?: number
  /** errno 或错误码名，例如 `ENOTFOUND`、`ENOENT`、`EACCES`。 */
  errCode?: string
  /** 原文：命令吐出的那一份（合并、遮蔽、截断之前或之后都可以，判档只读它）。 */
  text: string
}

/** 判据的层次。数组顺序**就是**判档顺序，门禁断言规则表里的层次不倒退。 */
export type RuleLayer = 'fact' | 'errcode' | 'phrase' | 'vague' | 'fallback'

/** 文档写明的层次顺序（ADR 第 2 节第 3 条）。表里的规则按这个顺序往下排。 */
export const RULE_LAYERS: readonly RuleLayer[] = ['fact', 'errcode', 'phrase', 'vague', 'fallback']

/**
 * 一条判据。`when` 与 `pattern` 至少给一个，两个都给就是「都要满足」。
 * `example` 是「必须命中我」的最小样本，门禁拿它跑判档并断言结果等于 `kind`。
 * `note` 写给下一个人看：这条挡的是哪种故障、为什么排在这个位置。
 */
export interface ErrorRule {
  /** 命中后归哪一档（八档之一，类目真源在 contract/vocabulary.ts）。 */
  kind: ErrorKind
  /** 这条属于哪一层证据。层号只能按 `RULE_LAYERS` 的顺序往前走。 */
  layer: RuleLayer
  /** 按结构化事实判。 */
  when?: (facts: ErrorFacts) => boolean
  /** 按原文判（正则不带 g 标志，避免 lastIndex 状态）。 */
  pattern?: RegExp
  /** 这条规则的最小样本：单独喂进来，判档结果必须正好是 `kind`。 */
  example: ErrorFacts
  /** 这条规则挡的是哪种故障、为什么在这个位置（写给下一个人，不复述类型名）。 */
  note: string
}

/** 这条事实里有没有某个错误码名：`errCode` 明写着就用它，否则在原文里按词边界找。 */
function hasCode(facts: ErrorFacts, ...names: string[]): boolean {
  const own = String(facts.errCode || '').toUpperCase()
  if (own && names.includes(own)) return true
  const text = String(facts.text || '').toUpperCase()
  return names.some((name) => new RegExp('(?:^|[^A-Z0-9_])' + name + '(?:[^A-Z0-9_]|$)').test(text))
}

/** 规则是否命中这份事实：`when` 与 `pattern` 都给了就都要满足。 */
function matches(rule: ErrorRule, facts: ErrorFacts): boolean {
  if (typeof rule.when === 'function' && !rule.when(facts)) return false
  if (rule.pattern && !rule.pattern.test(facts.text)) return false
  return typeof rule.when === 'function' || Boolean(rule.pattern)
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、通用规则表（唯一真源）
// ─────────────────────────────────────────────────────────────────────────────

/** 网络类错误码名：操作系统/HTTP 库给的名字，认名字比认散句可靠。 */
const NETWORK_CODES = [
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
]

export const COMMON_RULES: readonly ErrorRule[] = [
  // ── ① 结构化事实：机器给的码，不看正文里写没写 ──────────────────────────────
  {
    kind: ERROR_KIND.AUTH,
    layer: 'fact',
    when: (f) => f.status === 401,
    example: { status: 401, text: 'HTTP 401: Bad credentials' },
    note: 'HTTP 401 = 凭据无效。凭状态码判，不靠正文里有没有「401」几个字',
  },
  {
    kind: ERROR_KIND.RATELIMIT,
    layer: 'fact',
    when: (f) => f.status === 403
      && /rate ?limit|too many requests|secondary rate limit/i.test(String(f.text || '')),
    example: { status: 403, text: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)' },
    note: '票面记下的那起实测错判：GitHub 限流回的是 HTTP 403，光看码会判成「没登录」，'
      + '让人白白去登录一轮。所以 403 里带限流文案的必须在下面那条通用 403 之前认走 —— '
      + '这一条属于通用表，各家不许再抄一份（正因为它是「403 加上限流字样」这种跨家都会遇到的组合）',
  },
  {
    kind: ERROR_KIND.AUTH,
    layer: 'fact',
    when: (f) => f.status === 403,
    example: { status: 403, text: 'HTTP 403: Resource not accessible by integration' },
    note: 'HTTP 403 = 权限不足。注意它排在「403 加限流文案」之后：本条是通用口径，'
      + '被限流的那一种更具体、已经被上面那条认走了',
  },
  {
    kind: ERROR_KIND.NOTFOUND,
    layer: 'fact',
    when: (f) => f.status === 404,
    example: { status: 404, text: 'HTTP 404: Not Found' },
    note: 'HTTP 404 = 资源不存在（票、仓库、标签都算）',
  },
  {
    kind: ERROR_KIND.RATELIMIT,
    layer: 'fact',
    when: (f) => f.status === 429,
    example: { status: 429, text: 'HTTP 429: Too Many Requests' },
    note: 'HTTP 429 = 被限流，建议稍后再试（不是让用户去重新登录）',
  },

  // ── ② 错误码名：认名字，认词边界 ───────────────────────────────────────────
  {
    kind: ERROR_KIND.ENV,
    layer: 'errcode',
    when: (f) => hasCode(f, 'ENOENT'),
    example: { text: "ENOENT: no such file or directory, open '/tmp/x'" },
    note: '本机缺文件/缺可执行文件 —— 必须排在④「not found」之前，否则命令名会被当成资源名',
  },
  {
    kind: ERROR_KIND.NETWORK,
    layer: 'errcode',
    when: (f) => hasCode(f, ...NETWORK_CODES),
    example: { errCode: 'ENOTFOUND', text: 'getaddrinfo ENOTFOUND api.github.com' },
    note: '#620 实测复现过的那一起错判：这句原文曾被上一版的 `not ?found`（空格可省）吞成「找不到」，'
      + '界面于是让人去核对标签名。词边界写法 + 排在④之前，两件事一起才治得住',
  },
  {
    kind: ERROR_KIND.AUTH,
    layer: 'errcode',
    when: (f) => hasCode(f, 'EACCES', 'EPERM'),
    example: { text: "EACCES: permission denied, open '/etc/hosts'" },
    note: '权限不足归 auth（八档里没有单列「权限」一档），与④之前的排名无关——它在②，比所有句式都硬',
  },

  // ── ③ 专有句式：整句认得出，就不是含糊的英文短语 ────────────────────────────
  {
    kind: ERROR_KIND.ENV,
    layer: 'phrase',
    pattern: /is not recognized|command not found|no such file|cannot find|not found in path|which:\s*no/i,
    example: { text: 'sh: 1: glab: command not found' },
    note: '命令没装/文件不在本机 —— 环境问题，不是资源不存在。排在④之前是 #124 定版的第一条铁律',
  },
  {
    kind: ERROR_KIND.RATELIMIT,
    layer: 'phrase',
    pattern: /rate ?limit|too many requests|secondary rate limit/i,
    example: { text: 'API rate limit exceeded for user ID 1.' },
    note: '限流文案。排在认证句式之前：一句里同时出现限流与权限词时，限流是更具体的那一种'
      + '（本题实测错判之一就是 403 加这句被通用词表判成了「没登录」）',
  },
  {
    kind: ERROR_KIND.AUTH,
    layer: 'phrase',
    pattern: /not logged in|authentication|bad credentials|unauthorized|permission denied|does not have the correct permissions|credential|\bauth\b/i,
    example: { text: 'gh: To get started with GitHub CLI, please run: gh auth login' },
    note: '认证/权限句式。GraphQL 的权限句是复数（does not have the correct permissions），'
      + '单数的 permission denied 认不出它（#992）；具体的变更名（如 AddLabelsToLabelable）属各家扩展项',
  },
  {
    kind: ERROR_KIND.NETWORK,
    layer: 'phrase',
    pattern: /getaddrinfo|no such host|could not resolve host|temporary failure in name resolution|connection (refused|reset|closed|timed out)|failed to connect|unable to access|dial tcp|socket hang up|fetch failed|tls handshake|proxy|\btimeout\b|timed out|\beof\b|network is unreachable|offline/i,
    example: { text: 'fatal: unable to access \'https://api.github.com/\': Failed to connect to api.github.com port 443: Connection timed out' },
    note: '连接层的整句特征。排在④之前：这些句子里的「not found / no such」属于连接层，不是资源层',
  },

  // ── ④ 含糊英文短语：整句认不出，只剩常见词 ──────────────────────────────────
  {
    kind: ERROR_KIND.NOTFOUND,
    layer: 'vague',
    pattern: /\bnot\s+found\b/i,
    example: { text: 'Issue not found' },
    note: '含糊短语收紧成词边界：`ENOTFOUND` 里没有词边界，②已经先认走了，不会掉到这里（这就是本条的来历）',
  },
  {
    kind: ERROR_KIND.UNSUPPORTED,
    layer: 'vague',
    pattern: /unsupported|not support(?:ed)?|does not support|not implemented/i,
    example: { text: 'This backend does not support the requested field' },
    note: '该后端没这个能力（能力缺失，不是操作失败）——调用方据此换路，不该提示用户重试。'
      + '词表里必须收住「does not support」这种真实写法：只写 `not supported` 会连自带的样本都命中不了'
      + '（规则表自证门禁当场变红，这不是理论问题）',
  },
  {
    kind: ERROR_KIND.PARSE,
    layer: 'vague',
    pattern: /parse|invalid json|syntax|unexpected token/i,
    example: { text: 'Unexpected token < in JSON at position 0' },
    note: '回包不是我们认识的形状（解析失败）——多半是上游换了协议或返回了 HTML 错误页。'
      + '`unexpected token` 是解析器最常吐的那一句，必须收住，否则自带样本命中不了自己',
  },
  {
    kind: ERROR_KIND.NETWORK,
    layer: 'vague',
    pattern: /network|offline/i,
    example: { text: 'network error: connection lost' },
    note: '只剩「网络」这个模糊词时的兜底判断；真正的连接特征在③已经认走了',
  },

  // ── ⑤ 兜底 ────────────────────────────────────────────────────────────────
  {
    kind: ERROR_KIND.NETWORK,
    layer: 'fallback',
    when: () => true,
    example: { text: 'zsh: segmentation fault (core dumped)' },
    note: '一条都没命中就归网络（#124 定版④）。分类是启发式的、可能猜错——'
      + '所以原文必须随结果一起交出去，让人自己判断',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 三、事实对象的组装与原文的取法
// ─────────────────────────────────────────────────────────────────────────────

/** 原文截断口径：头 600 + 省略标记 + 尾 200（gh 的错因常在尾部，只留头会把它切掉）。 */
export const RAW_HEAD = 600
export const RAW_TAIL = 200

/** 凭据样式的遮蔽标记。原文要给人看懂发生了什么，但不等于能把凭证粘进 issue。 */
const MASKED = '***（凭据已遮蔽）'

/**
 * 遮蔽已知的凭据样式：GitHub 令牌（`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/`github_pat_`）、
 * GitLab 令牌（`glpat-`）、`Bearer` 与 `Authorization:` / `PRIVATE-TOKEN:` 头、
 * URL 里的 `user:password@`、查询串里的 `private_token=` / `access_token=` / `token=`。
 * 幂等：已经遮蔽过的文本再进一次不会再变。
 */
export function maskSecrets(input: string): string {
  return String(input == null ? '' : input)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{8,}/g, MASKED)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}/g, MASKED)
    .replace(/\bglpat-[A-Za-z0-9_\-]{8,}/g, MASKED)
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi, '$1' + MASKED)
    .replace(/(Authorization\s*:\s*)\S+/gi, '$1' + MASKED)
    // GitLab 用 PRIVATE-TOKEN 头；`\S+` 会把整行剩下的内容一起吃掉，所以按行取到空白为止。
    .replace(/(PRIVATE-TOKEN\s*:\s*)[^\s]+/gi, '$1' + MASKED)
    .replace(/([?&](?:private_token|access_token|token)=)[^&\s]+/gi, '$1' + MASKED)
    .replace(/(\/\/[^/\s:@]+:)([^@\s/]+)(@)/g, '$1' + MASKED + '$3')
}

/** 头尾截断（中间裁掉）。已经是截断过的文本原样返回，不会挨第二刀。 */
export function clipRaw(input: string): string {
  const s = String(input == null ? '' : input)
  if (s.indexOf('（原文中间省略') >= 0) return s
  if (s.length <= RAW_HEAD + RAW_TAIL) return s
  const cut = s.length - RAW_HEAD - RAW_TAIL
  return s.slice(0, RAW_HEAD)
    + '\n……（原文中间省略 ' + cut + ' 个字符；这里保留开头 ' + RAW_HEAD + ' 与结尾 ' + RAW_TAIL + ' 字）……\n'
    + s.slice(s.length - RAW_TAIL)
}

/** 一个错误值里所有能当原文的文本，按 ADR 第 2 节第 4 条的顺序：stderr → message → stdout。 */
function rawParts(input: unknown): string[] {
  if (input == null) return []
  if (typeof input === 'string') return input ? [input] : []
  if (typeof input !== 'object') return [String(input)]
  const o = input as Record<string, unknown>
  const out: string[] = []
  const push = (v: unknown): void => {
    const s = v == null ? '' : String(v)
    if (s && out.indexOf(s) < 0) out.push(s)
  }
  push(o.stderr)
  push(o.message)
  push(o.stdout)
  push(o.text)
  const inner = o.error
  if (inner && typeof inner === 'object') push((inner as Record<string, unknown>).message)
  else push(inner)
  return out
}

/**
 * 取原文：多路合并（stderr、message、stdout 都要，不再三选一）→ 遮蔽凭据 → 头尾截断。
 * 三件事都只在这里做一次；`fail()` 的第三段直接调它，所以「每个失败都带原文」是一条可断言的规则。
 */
export function rawText(input: unknown): string {
  return clipRaw(maskSecrets(rawParts(input).join('\n')))
}

/** 从原文里认出 HTTP 状态码：只认这四个数字（与仓库既有 `pickHttpCode` 同一份口径）。 */
function statusFromText(text: string): number | undefined {
  const m = /\b(401|403|404|429)\b/.exec(String(text || ''))
  return m ? Number(m[1]) : undefined
}

/** 从任意错误值里整理出判档要的事实对象。 */
export function factsFromError(input: unknown): ErrorFacts {
  const o = (input && typeof input === 'object') ? input as Record<string, unknown> : null
  const text = rawText(input)
  const code = o ? o.code : undefined
  const facts: ErrorFacts = { text }
  if (o) {
    const status = o.status != null ? o.status : o.statusCode
    if (typeof status === 'number') facts.status = status
    // 退出码两种写法都认：契约里这个事实叫 `exitCode`，而 `gh` 的执行结果与 Node 的 `err.code`
    // 里叫 `code`。只认其中一个，手工拼的事实就会被静默丢掉（GitHub 房实测踩过：退出码 4 判不出没登录）。
    const exit = o.exitCode != null ? o.exitCode : code
    if (typeof exit === 'number') facts.exitCode = exit
    else if (typeof exit === 'string' && exit) facts.errCode = exit
    if (!facts.errCode && typeof o.errCode === 'string' && o.errCode) facts.errCode = o.errCode
    const errno = o.errno
    if (!facts.errCode && typeof errno === 'string' && errno) facts.errCode = errno
  }
  return facts
}

/** 补齐缺失的事实：调用方没给状态码时，从原文里认出那四个数字（给了就以给的为准）。 */
function fillFacts(input: ErrorFacts): ErrorFacts {
  const facts: ErrorFacts = { text: String(input && input.text != null ? input.text : '') }
  if (input) {
    if (typeof input.status === 'number') facts.status = input.status
    if (typeof input.exitCode === 'number') facts.exitCode = input.exitCode
    if (input.errCode) facts.errCode = String(input.errCode)
  }
  if (facts.status === undefined) facts.status = statusFromText(facts.text)
  return facts
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、判档与归一埋点
// ─────────────────────────────────────────────────────────────────────────────

/** 判档时要用的最小上下文：只为了留一条 `error.normalize` 轨迹。 */
export interface ClassifyCtx {
  logEvent?: (level: string, event: string, fields: Record<string, unknown>) => void
  isEnabled?: (level: string) => boolean
}

/** 归一前那份「原始类别」的写法（沿用 GitHub 房间既有口径，读日志的人不用重新学）。 */
function rawKindOf(facts: ErrorFacts): string {
  if (typeof facts.status === 'number' && facts.status) return 'http:' + facts.status
  if (typeof facts.exitCode === 'number') return 'exit:' + facts.exitCode
  if (facts.errCode) return 'errno:' + String(facts.errCode).toUpperCase()
  return 'unknown'
}

/** 已发过的归一轨迹签名：同一件事连着记第二次是噪音，与既有实现同款去重。 */
let lastNormalizeSignature = ''

/**
 * 发一条 `error.normalize`：只记归一前后的档位、依据是哪一档事实、码值，不记原文
 * （日志红线：可重放的凭据原文永不落盘）。
 * 字段含义见 `research/489-appendix.md` 第 1 章第 43 行；改含义要发新事件。
 */
function emitNormalize(ctx: ClassifyCtx | undefined, fields: Record<string, unknown>): void {
  try {
    if (!ctx || typeof ctx.logEvent !== 'function') return
    if (typeof ctx.isEnabled !== 'function' || !ctx.isEnabled('debug')) return
    const signature = String(fields.rawKind) + '|' + String(fields.mappedKind) + '|' + String(fields.layer)
    if (signature === lastNormalizeSignature) return
    lastNormalizeSignature = signature
    ctx.logEvent('debug', 'error.normalize', fields)
  } catch {
    // 埋点坏了不影响判档本身
  }
}

/** 归一埋点的对外入口：已经是规范档位的失败（透传那一路）也留同一趟轨迹。 */
export function emitPassthrough(ctx: ClassifyCtx | undefined, kind: ErrorKind): void {
  emitNormalize(ctx, { rawKind: 'passthrough', mappedKind: kind, layer: 'passthrough' })
}

/** 判档结果：档位 + 这条档位是哪一层规则给的。 */
export interface Judged {
  kind: ErrorKind
  /**
   * 命中的层。规则表那五层之外还有一个 `'passthrough'`：错误值里本来就写着规范档位
   * （后端显式产生的 conflict / unsupported，或上游已经判好的失败），判档只是原样交出去、
   * 没有经过任何一条规则 —— 日志里要能一眼看出这两种来源的区别。
   */
  layer: RuleLayer | 'passthrough'
  /**
   * 命中的是不是兜底那一层（表里一条都没认出来，只能按网络归类）。
   * 调用方据此换成 `HINT_UNRECOGNIZED`：猜不出来的时候，话术要老实说自己没认出来。
   */
  fallback: boolean
}

/**
 * 判不出来时的通用提示（票面实现决定第 11 条：兜底与「不支持」两档的 message 必须说清
 * 「插件未能识别」并指引看原文，而不是各写各的）。原文另在失败结果的 `raw` 里，界面能展开。
 */
export const HINT_UNRECOGNIZED = '插件未能识别这次失败的具体原因，请展开下面的原文自己判断'

/** 「这个后端没有这项能力」的通用提示（同上，offer 换路而不是让人重试）。 */
export const HINT_UNSUPPORTED = '这个后端没有这项能力，所以这次操作没有执行；细节见下面的原文'

/**
 * 按「先各家前置扩展、再通用表」的顺序找出命中的那一条规则。
 *
 * 单独交出来是给门禁用的：规则表自证要求「每条规则用它自带的样本跑，命中的必须就是它自己」——
 * 拿不到命中者（只拿到档位）就证明不了这件事，两条同档位的规则会互相掩盖。
 *
 * @param input 事实对象或任何含事实的错误值
 * @param extensions 本家特有的前置扩展项
 */
export function matchRule(
  input: ErrorFacts,
  extensions: readonly ErrorRule[] = [],
): { rule: ErrorRule; via: 'extension' | 'common' } {
  const facts = fillFacts(input)
  for (const rule of extensions) {
    if (matches(rule, facts)) return { rule, via: 'extension' }
  }
  for (const rule of COMMON_RULES) {
    if (matches(rule, facts)) return { rule, via: 'common' }
  }
  // 通用表最后一条是 `when: () => true` 的兜底项，所以上面一定命中；这里只是类型上的兜底。
  return { rule: COMMON_RULES[COMMON_RULES.length - 1], via: 'common' }
}

/**
 * 判档：先试各家的前置扩展表，再试通用表，第一条命中的就是结果。
 * 与 `judgeFacts` 同一趟判定，但把「是谁给的」也交出来 —— 走兜底层时调用方要改用
 * `HINT_UNRECOGNIZED`，不能拿本家的上下文话术假装判出来了。
 * @param input 事实对象（状态码/退出码/错误码名 + 原文）
 * @param extensions 本家特有的前置扩展项（不许复制通用项，门禁拦着）
 * @param ctx 有它才可能留一条 `error.normalize`（调试开关在外层判，关着时零组装）
 */
export function judgeFactsDetailed(
  input: ErrorFacts,
  extensions: readonly ErrorRule[] = [],
  ctx?: ClassifyCtx,
): Judged {
  const started = Date.now()
  const facts = fillFacts(input)
  const { rule, via } = matchRule(facts, extensions)
  const fields: Record<string, unknown> = {
    rawKind: rawKindOf(facts),
    mappedKind: rule.kind,
    layer: rule.layer,
    via: via,
    latencyMs: Date.now() - started,
  }
  if (typeof facts.status === 'number' && facts.status) fields.httpCode = facts.status
  if (typeof facts.exitCode === 'number') fields.exitCode = facts.exitCode
  if (facts.errCode) fields.errCode = String(facts.errCode).toUpperCase()
  emitNormalize(ctx, fields)
  return { kind: rule.kind, layer: rule.layer, fallback: rule.layer === 'fallback' }
}

/**
 * 只要档位的简写版（多数调用方够用）。需要知道「是不是兜底判的」就用 `judgeFactsDetailed`。
 */
export function judgeFacts(
  input: ErrorFacts,
  extensions: readonly ErrorRule[] = [],
  ctx?: ClassifyCtx,
): ErrorKind {
  return judgeFactsDetailed(input, extensions, ctx).kind
}
