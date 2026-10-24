// src/deck/tools/suggest-next-steps.ts —— suggest_next_steps：在回复末尾推荐 2~4 条下一步提示词（#1406）
//
// 这颗工具的参数里就直接带着给界面用的建议清单：界面从这次工具调用的参数本身读走建议、
// 渲染成气泡，工具这边只做校验、钳制、截断与回执，不写票、不落任何状态。
//
// 每条建议由三格必填加一格选填组成：选项框上只显示的一句简介（十个字以内，一眼说清这一步
// 做什么）、一句可以直接执行的提示词（点选后才填进输入框，平时不显示）、一句理由（收进框正
// 上方的悬停浮层），外加一个可选的推荐优先级（0 到 10 的数字，分高靠左，没打分的排最后）。
// 为什么单要一个简介：界面上的胶囊一行排不下整句提示词，三条竖着堆成一列也读不过来（#1451）。
//
// 为什么单独一份、不进九个 deck_* 工具的装配顺序表：那九颗是追踪器工具，参数表、回执表、
// 点数表与装配顺序都是冻结契约（#1106 门禁逐字冻结）；建议工具不属于追踪器，走「只增不改的
// 独立登记」，先例是同样在九工具之外单独注册的 deck_probe（见 agent-row.ts）。
//
// 参数形状为什么没有 minItems / maxItems：工具注册表只接受一个受支持的 JSON Schema 子集
// （@deepseek-ai/dsh-tools 的 assertSupportedJsonSchema，本仓库既有门禁按它逐字验过），
// 该子集里没有 minItems / maxItems。所以「2~4 条」这条约束写在参数说明里，由本文件自己钳制，
// 上下限另导出成常量（MIN_ITEMS / MAX_ITEMS）供界面侧引用，不依赖参数模式去保证。
//
// 会话目录为什么本文件还要自己补一处回退：九颗追踪器工具由宿主代执行，代执行那层会先造一个带目录的
// exec；本工具在行里本地执行，拿到的 exec 是平台原生形状——真机探针证明会话顶层没有目录，目录住在
// exec.agent.session.header 里（与 agent-row.ts 的 sessionHintOf 同口径）。共享的会话目录壳
// （src/deck/shell/session-workdir.ts）被九工具共用、行为冻结，所以只在本文件补自己这一份回退。

import { createDeckShell, DECK_STATUS, REFUSAL_REASONS } from '../shell/call-shell.js'
import { sessionContextOfAsync } from '../shell/session-workdir.js'
import { hash8 } from '../../refresh/contract/workspace-keys.js'

/** 外层递进来的东西（参数、exec、日志、时钟）形状都不由本文件定，逐格验，不猜。 */
type UnknownRecord = Record<string, unknown>

/** 工具名：对外精确名字，不带 deck_ 前缀；界面按它认出「这次调用是建议工具」。 */
export const SUGGEST_TOOL_NAME = 'suggest_next_steps'
/** 建议条数的合法区间：少于下限整次拒绝，多于上限按优先级留前几条（没打分的先被截掉）。界面侧按同一组数再校验一次。 */
export const MIN_ITEMS = 2
export const MAX_ITEMS = 4
/** 单项文本上限：简介、提示词、理由各一个。按 Unicode 码点数算，避免把 emoji 之类的代理对切坏。 */
/** 推荐优先级的合法区间：0 到 10，分越高越靠左；拿不准就别给，没给的排最后。 */
export const PRIORITY_MIN = 0
export const PRIORITY_MAX = 10
export const INTRO_MAX_CHARS = 10
export const PROMPT_MAX_CHARS = 500
export const REASON_MAX_CHARS = 200

/** 工具定义：名字、一句话介绍、参数模式。参数形状是本票冻结的契约，界面票照它读。 */
export const definition = {
  name: SUGGEST_TOOL_NAME,
  description: '在回复末尾推荐 2~4 条下一步提示词，界面会显示成气泡；只在有明确下一步时调用。',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: '要推荐的下一步提示词，2~4 项；多于 4 项时只保留前 4 项，少于 2 项会被拒绝。',
        items: {
          type: 'object',
          properties: {
            intro: { type: 'string', description: '简介：一句话说清这一步做什么，不超过 10 个字；选项框上只显示这一句，完整提示词点选后才填进输入框。' },
            prompt: { type: 'string', description: '可以直接执行的下一步提示词，例如 /to-tickets。' },
            reason: { type: 'string', description: '一句话说明为什么建议这一步。' },
            priority: { type: 'number', description: '推荐优先级：0 到 10 的数字，分越高越建议先做，界面按分从高到低往左排；拿不准就别给，没给的统一排在最后。' },
          },
          required: ['intro', 'prompt', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
}

/** 一条建议：十字以内的简介、提示词、一句话理由（三者都已截断到上限之内），外加可选的推荐
 *  优先级（有效数字钳到 0~10 并留一位小数；没打分的是 null，界面统一排在最后）。 */
export interface SuggestItem {
  intro: string
  prompt: string
  reason: string
  priority: number | null
}
/** 这一次调用收了几条、实际留下几条、有几条被截断（日志与回执共用同一组数）。 */
export interface SuggestCounts {
  received: number
  returned: number
  clipped: number
}
/** 参数校验的结论：接受就带 items；拒绝就带机器码 reason 与给 AI 看的一句话。 */
export interface SuggestResolution {
  accepted: boolean
  reason: string
  text: string
  items: SuggestItem[]
  counts: SuggestCounts
  notes: string[]
}

/** 日志口：只要求 fire 一格（与宿主日志上下文同形），没有日志也不影响工具干活。 */
export interface SuggestLogLike {
  fire?: (level: string, event: string, fields: UnknownRecord) => void
}
/** 本工具的依赖袋：log 可选（宿主接线程给），now 只给测试换假时钟。 */
export interface SuggestDeps {
  log?: SuggestLogLike | null
  now?: () => number
}

/**
 * 按 Unicode 码点截断文本：没超长原样返回；超长切到上限以内并在末尾补一个省略号。
 * 为什么不用 slice：UTF-16 单元切在代理对中间会切出半个字符，界面显示成乱码。
 */
export function clipText(text: string, max: number): { text: string; clipped: boolean } {
  const chars = Array.from(text)
  if (chars.length <= max) return { text: text, clipped: false }
  return { text: chars.slice(0, Math.max(1, max - 1)).join('') + '…', clipped: true }
}

/** 把任意一格按字符串收：不是字符串就当空串（后面按「缺」处理）。 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 优先级归一化：有效数字钳到 0~10 并留一位小数（9.5 这类）；不是数字、NaN、无穷大
 * 一律当没打分（null）。为什么 null 而不是 0：0 是「最后再做」，没打分是「不知道」，
 * 用户拍板没打分的统一排在最后，而不是和 0 分混在一起。
 */
function normalizePriority(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const clamped = Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, value))
  return Math.round(clamped * 10) / 10
}

/**
 * 校验并整理参数：只认 { items: [{ intro, prompt, reason }, ...] }。
 *
 * 规矩（本票冻结，界面票照它写）：
 * - items 不是数组、少于两条、任意一条缺 intro 或 prompt 或 reason（trim 后为空）——整次拒绝，不补编建议；
 * - priority 可选：有效数字收下（钳到 0~10、留一位小数），没给或不是数字就当没打分，不拒绝；
 * - 排序：打了分的按分从高到低往左排并列保持模型给的相对顺序；没打分的统一放末尾、彼此保持原顺序；
 * - 多于四条——排好序之后留前四条，所以截掉的永远是分最低或没打分的；
 * - 单项超长——截断并补省略号，不报错。
 * 返回值里 accepted 是唯一稳定的「成功/拒绝」标记，调用方不要靠 items.length 判断。
 */
export function resolveSuggestItems(args: unknown): SuggestResolution {
  function refuse(reason: string, text: string, notes: string[], received: number): SuggestResolution {
    return { accepted: false, reason: reason, text: text, items: [], counts: { received: received, returned: 0, clipped: 0 }, notes: notes }
  }
  const bag = (args && typeof args === 'object' && !Array.isArray(args)) ? args as UnknownRecord : {}
  const raw = bag.items
  if (!Array.isArray(raw)) {
    return refuse(REFUSAL_REASONS.BAD_ARGS,
      '这次没给建议清单（items 不是一个数组），我没记下任何建议：请一次给 2~4 条再调一次。',
      ['bad-items:not-array'], 0)
  }
  const received = raw.length
  if (received < MIN_ITEMS) {
    return refuse(REFUSAL_REASONS.BAD_ARGS,
      '这次的建议只有 ' + received + ' 条，少于 ' + MIN_ITEMS + ' 条，我没记下任何建议：请给 2~4 条再调一次。',
      ['too-few:' + received], received)
  }
  const notes: string[] = []
  if (received > MAX_ITEMS) notes.push('trimmed:' + received + '→' + MAX_ITEMS)
  const valid: SuggestItem[] = []
  let clipped = 0
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    const rec = (entry && typeof entry === 'object' && !Array.isArray(entry)) ? entry as UnknownRecord : null
    const intro = asString(rec ? rec.intro : '').trim()
    const prompt = asString(rec ? rec.prompt : '').trim()
    const reason = asString(rec ? rec.reason : '').trim()
    if (!intro || !prompt || !reason) {
      return refuse(REFUSAL_REASONS.BAD_ARGS,
        '这次的建议里第 ' + (i + 1) + ' 条缺简介、提示词或理由，我没记下任何建议：请每条都给 intro、prompt 与 reason 再调一次。',
        notes.concat(['bad-item:' + (i + 1)]), received)
    }
    const introPart = clipText(intro, INTRO_MAX_CHARS)
    const promptPart = clipText(prompt, PROMPT_MAX_CHARS)
    const reasonPart = clipText(reason, REASON_MAX_CHARS)
    if (introPart.clipped || promptPart.clipped || reasonPart.clipped) clipped += 1
    valid.push({ intro: introPart.text, prompt: promptPart.text, reason: reasonPart.text, priority: normalizePriority(rec ? rec.priority : undefined) })
  }
  // 排序（Array.prototype.sort 稳定，并列保持模型给的相对顺序）：打了分的按分从高到低往左排；
  // 没打分的统一放末尾、彼此保持原顺序。排好再截到上限，截掉的永远是分最低或没打分的。
  valid.sort(function (a, b) {
    if (a.priority === null && b.priority === null) return 0
    if (a.priority === null) return 1
    if (b.priority === null) return -1
    return (b.priority as number) - (a.priority as number)
  })
  const items = valid.length > MAX_ITEMS ? valid.slice(0, MAX_ITEMS) : valid
  if (clipped > 0) notes.push('clipped:' + clipped)
  const text = received > MAX_ITEMS
    ? '已记下前 ' + MAX_ITEMS + ' 条下一步建议（收到 ' + received + ' 条，按优先级从高到低留前 ' + MAX_ITEMS + ' 条，没打分的排在最后）。'
    : '已记下 ' + items.length + ' 条下一步建议。'
  return { accepted: true, reason: '', text: text, items: items, counts: { received: received, returned: items.length, clipped: clipped }, notes: notes }
}

/** 从 header 取到目录后的结论：与共享壳成功支同形（多出来的 text 只是让两支结构一致）。 */
interface HeaderSessionOk {
  ok: true
  cwd: string
  workspaceKey: string
  sessionId: string
  source: string
  text: string
}

/**
 * 仅供本工具用的会话目录回退：从 exec.agent.session.header 里取目录与会话号。
 *
 * 为什么需要：真机里本工具拿到的 exec 是平台原生形状，会话顶层没有目录，目录住在 header 里
 * （agent-row.ts 的 sessionHintOf 对这件事有完整注释与同样的取值顺序）。取不到就回 null，
 * 由调用方按「没有会话上下文」如实拒绝。
 * source 记真实位置，排错时一眼看出是从 header 的哪一格拿到的；工作区键按同目录的短散列兜底。
 */
function sessionFromHeader(exec: unknown): HeaderSessionOk | null {
  try {
    const e = (exec || {}) as UnknownRecord
    const agent = (e.agent || {}) as UnknownRecord
    const sessionRaw = (agent.session || e.session || null) as UnknownRecord | null
    if (!sessionRaw || typeof sessionRaw !== 'object') return null
    const session: UnknownRecord = sessionRaw
    const header = session.header as UnknownRecord | null | undefined
    if (!header || typeof header !== 'object') return null
    let cwd = ''
    let source = ''
    if (typeof header.cwd === 'string' && header.cwd.trim()) {
      cwd = header.cwd.trim()
      source = 'exec.agent.session.header.cwd'
    } else if (typeof header.workspaceRoot === 'string' && header.workspaceRoot.trim()) {
      cwd = header.workspaceRoot.trim()
      source = 'exec.agent.session.header.workspaceRoot'
    }
    if (!cwd) return null
    let sessionId = ''
    if (typeof session.id === 'string' && session.id) sessionId = session.id
    else if (typeof session.sessionId === 'string' && session.sessionId) sessionId = session.sessionId
    else if (typeof header.id === 'string' && header.id) sessionId = header.id
    else if (typeof header.sessionId === 'string' && header.sessionId) sessionId = header.sessionId
    else if (typeof agent.sessionId === 'string' && agent.sessionId) sessionId = agent.sessionId
    return { ok: true, cwd: cwd, workspaceKey: 'ws-' + hash8(cwd), sessionId: sessionId, source: source, text: '' }
  } catch (ePick) { return null }
}

/**
 * 先走共享壳的会话目录（六个位置），失败再看 header 一处回退。
 * 两支都取不到就把共享壳的失败支原样带回：reason 与 sessionId 照旧交给日志与回执，不另造语义。
 */
async function sessionContextOrHeader(exec: unknown) {
  const base = await sessionContextOfAsync(exec)
  if (base.ok) return base
  const fromHeader = sessionFromHeader(exec)
  if (fromHeader) return fromHeader
  return base
}

/** 成功与拒绝在日志里都落 info 的 host.call：reason 记清是条数还是拒绝原因，ok 分辨成功失败。 */
function logReasonOf(res: SuggestResolution): string {
  if (!res.accepted) {
    const base = res.reason || REFUSAL_REASONS.BAD_ARGS
    return res.counts.received > 0 ? base + ':' + res.counts.received : base
  }
  return 'items=' + res.counts.received + ';returned=' + res.counts.returned + ';clipped=' + res.counts.clipped
}

/**
 * 造这颗工具：返回 { definition, run }。
 * run(exec, args) 永不抛：参数不对、没有会话上下文、中途被中止都包成统一回执壳里的拒绝信封；
 * 内部真出了意外也兜成 unsupported，不影响对话继续进行。
 */
export function createSuggestNextSteps(deps?: SuggestDeps) {
  const d = (deps || {}) as SuggestDeps
  const shell = createDeckShell({})
  const log = (d.log || null) as SuggestLogLike | null
  const now: () => number = typeof d.now === 'function' ? d.now : Date.now

  /** 落一行轨迹：沿用既有事件 host.call 与字段白名单（工作区只记散列，会话号不进日志）。 */
  function fireLog(latencyMs: number, ok: boolean, reason: string, cwd: string): void {
    try {
      if (!log || typeof log.fire !== 'function') return
      const fields: UnknownRecord = { method: SUGGEST_TOOL_NAME, latencyMs: latencyMs, ok: ok, kind: 'deck-tool' }
      if (reason) fields.reason = reason
      const cwdHash = cwd ? hash8(cwd) : ''
      if (cwdHash) fields.cwdHash = cwdHash
      log.fire('info', 'host.call', fields)
    } catch (e) { /* 日志坏了不影响工具给建议 */ }
  }

  async function run(exec: unknown, args: unknown): Promise<UnknownRecord> {
    const t0 = now()
    try {
      const execBag = (exec && typeof exec === 'object') ? exec as UnknownRecord : {}
      const signal = execBag.signal as UnknownRecord | null | undefined
      if (signal && signal.aborted === true) {
        const ms = now() - t0
        fireLog(ms, false, 'aborted', '')
        return shell.unsupported(SUGGEST_TOOL_NAME, 'aborted', '这次调用被中止了，没记下任何建议：需要时再调一次。', { tookMs: ms })
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        const ms = now() - t0
        fireLog(ms, false, REFUSAL_REASONS.BAD_ARGS + ':args', '')
        return shell.unsupported(SUGGEST_TOOL_NAME, REFUSAL_REASONS.BAD_ARGS,
          '参数不是一个对象，我没法做：请按这个工具的参数说明（items 里的 intro、prompt 与 reason）重调一次。', { tookMs: ms })
      }
      const session = await sessionContextOrHeader(exec)
      if (!session.ok) {
        const ms = now() - t0
        const reason = session.reason || REFUSAL_REASONS.NO_SESSION
        fireLog(ms, false, reason, '')
        // 正文用本工具自己的口径：九工具那句「不动任何票」是追踪器的说法，建议工具不写票。
        return shell.unsupported(SUGGEST_TOOL_NAME, reason,
          '这次没拿到当前会话的工作区目录，没法记录建议：请重调一次；一直这样就去看日志。',
          { session: { id: session.sessionId }, tookMs: ms })
      }
      const resolved = resolveSuggestItems(args)
      const ms = now() - t0
      fireLog(ms, resolved.accepted, logReasonOf(resolved), session.cwd)
      const workspace = { root: session.cwd, key: session.workspaceKey, sessionId: session.sessionId, source: session.source }
      if (!resolved.accepted) {
        return shell.unsupported(SUGGEST_TOOL_NAME, resolved.reason, resolved.text, { workspace: workspace, notes: resolved.notes, tookMs: ms })
      }
      return shell.envelope(SUGGEST_TOOL_NAME, DECK_STATUS.OK, {
        text: resolved.text,
        workspace: workspace,
        data: { items: resolved.items, counts: resolved.counts },
        notes: resolved.notes,
        tookMs: ms,
      })
    } catch (e) {
      const ms = now() - t0
      fireLog(ms, false, 'threw', '')
      return shell.unsupported(SUGGEST_TOOL_NAME, REFUSAL_REASONS.BACKEND_THREW,
        '这颗工具内部出了意外，没记下任何建议：请重调一次；一直这样就去看日志。', { tookMs: ms })
    }
  }

  return { definition: definition, run: run }
}
