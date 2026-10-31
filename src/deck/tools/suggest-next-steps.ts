// src/deck/tools/suggest-next-steps.ts —— suggest_next_steps：在回复末尾推荐 2~4 条下一步提示词（#1406）
//
// 这颗工具的参数里就直接带着给界面用的建议清单：界面从这次工具调用的参数本身读走建议、
// 渲染成气泡，工具这边只做校验、钳制、截断与回执，不写票、不落任何状态。
//
// 每条建议由六格必填组成：选项框上只显示的一句简介（十五个字以内，英文按显示宽度折算约三十个
// 字符，一眼说清这一步做什么）、一句可以直接执行的提示词（点选后才填进输入框，平时不显示）、
// 悬停浮层里各占一行的理由（前因）、优点与缺点三格，以及一个 0 到 10 的推荐分（几条建议之间
// 「谁更该先做」的相对判断）。
// 为什么单要一个简介：界面上的胶囊一行排不下整句提示词，三条竖着堆成一列也读不过来（#1451）。
// 为什么把理由拆成理由/优点/缺点三格：一段话里同时塞前因、好处和代价，读起来是一团文字；
// 拆成三格后悬停浮层逐行显示，扫一眼就能判断这条该不该点（维护者 2026-10-31 拍板）。
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
/** 建议条数的合法区间：少于下限整次拒绝，多于上限按推荐分留前几条。界面侧按同一组数再校验一次。 */
export const MIN_ITEMS = 2
export const MAX_ITEMS = 4
/** 推荐分的合法区间：0 到 10，分越高越靠左；每条建议都必须给分（几条之间谁更该先做的相对判断）。 */
export const PRIORITY_MIN = 0
export const PRIORITY_MAX = 10
/** 简介上限按显示宽度算：汉字、全角标点与 emoji 算 2 格，其余字符算 1 格，30 格等于 15 个汉字；
 *  英文每个字母算 1 格，所以最多 30 个字符。 */
export const INTRO_MAX_WIDTH = 30
/** 提示词与三格理由文本都按 Unicode 码点数算，避免把 emoji 之类的代理对切坏；理由、优点、缺点
 *  各限 30 个字，悬停浮层里每格最多两行，再多就挤成一团（维护者 2026-10-31 定为统一上限 30）。 */
export const PROMPT_MAX_CHARS = 500
export const REASON_MAX_CHARS = 30
export const GAIN_MAX_CHARS = 30
export const COST_MAX_CHARS = 30

/** 工具定义：名字、一句话介绍、参数模式。参数形状是本票冻结的契约，界面票照它读。
 *  行为规则为什么写在说明里（#1412 反向后）：模型侧规则必须住在模型真能看到的地方。原先这节规则被
 *  拼在 /ask-matt 的返回正文末尾（读技能时追加），维护者 2026-10-24 认为风险太高、要求撤掉；规则内容
 *  于是搬进下面这几段说明，跟工具定义一起注册，模型在调用前就能读到。
 *  提示词为什么分两种写法（#1666）：模型默认会把每条提示词写成能直接发出的完整话，于是追问还没答
 *  就写成「我已回答」。其实提示词是用户下一轮要说的话，有的话现在就能说全，有的话还要用户先补
 *  一段才能说全（追问的答案、要贴的材料、待选的边）。后一种只写前半句并留出待填位置，还没发生
 *  的事留给用户填，不提前写成已发生。按 writing-for-agents 的写法，正面说清两种写法的目标，
 *  不只靠禁止去拦。 */
export const definition = {
  name: SUGGEST_TOOL_NAME,
  description: '推荐 2~4 条下一步建议。每轮回复收尾时先判断：用户接下来几乎一定会做什么？想得到就调用，想不到就不调用；这一轮在等用户拍板时，其中一条把他会选的答案列好；还有活没干完时不调用。',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: '每条是用户可能点的一个下一步，写全简介、提示词、理由、优点、缺点、推荐分六格。理由答「为什么是现在」，优点答「点下去得到什么」，缺点答「要付出什么」，推荐分给这几条排先后。每条 prompt 都是用户下一轮要说的话：开头写这一步对应的技能指令（/xxxx），后面跟内容；没有对应技能就只写内容。等用户补充的半句话，技能指令也仍然放在最开头。',
        items: {
          type: 'object',
          properties: {
            intro: { type: 'string', description: '一句话说清这一步做什么，15 个字以内；英文按显示宽度折算，最多 30 个字符。' },
            prompt: { type: 'string', description: '用用户的口气写用户下一轮会原样发出的话，只写现在就能确定的事，写清具体对象（文件、结论等），不写「继续推进」这类空话。还需要用户补充才能说全的话，只写前半句并留出待填位置（例如以冒号结尾，或用【在此填写…】标出要填的地方），还没发生的事留给用户填；实在写不清就换一条，不编具体值。' },
            reason: { type: 'string', description: '理由（前因）：这一轮里刚发生、用户自己看得见的那件事——刚做完什么、刚发现什么、还差什么；它就是这条现在该做的原因。一句 30 字以内。' },
            gain: { type: 'string', description: '优点：点下去马上拿到的东西，写到具体对象上——哪个文件改完、哪张票能关、哪个卡点解开；一句 30 字以内。' },
            cost: { type: 'string', description: '缺点：走这一步要付出的东西——要多花的时间、要多担的风险、这次先搁下的事；一句 30 字以内。' },
            priority: { type: 'number', description: '推荐分：0 到 10，只给这几条排先后。假设只能点一条，你会点的那条给 10，其次 8 左右，可缓的给 5 以下。' },
          },
          required: ['intro', 'prompt', 'reason', 'gain', 'cost', 'priority'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
}

/** 一条建议：简介、提示词、理由、优点、缺点五格文本（都已截断到上限之内），外加推荐分
 *  （有效数字钳到 0~10 并留一位小数）。 */
export interface SuggestItem {
  intro: string
  prompt: string
  reason: string
  gain: string
  cost: string
  priority: number
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
 * 按 Unicode 码点截断文本：没超长原样返回；超长保留前上限个码点，并在末尾另加一个省略号。
 * 维护者在 #1540 定下这个口径：超长时前面的内容都要显示，省略号是超长标记，不占上限的名额。
 * 为什么不用 slice：UTF-16 单元切在代理对中间会切出半个字符，界面显示成乱码。
 */
export function clipText(text: string, max: number): { text: string; clipped: boolean } {
  const chars = Array.from(text)
  if (chars.length <= max) return { text: text, clipped: false }
  return { text: chars.slice(0, Math.max(1, max)).join('') + '…', clipped: true }
}

/** 一个字符占的显示格数：汉字、全角标点与 emoji 算 2 格，其余（英文字母、数字、半角标点、空格）算 1 格。
 *  简介要按宽度而不是按字数卡上限：同样的格数里，英文能放下的字符数大约是汉字的两倍。 */
function charWidthOf(char: string): number {
  const cp = (char.codePointAt(0) || 0)
  if (cp >= 0x1100 && (
    cp <= 0x115f ||
    cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )) return 2
  return 1
}

/**
 * 按显示宽度截断简介：没超宽原样返回；超宽保留前面放得下的字符，并在末尾另加一个省略号。
 * 省略号是超长标记、不占宽度名额（#1540 的口径），按宽度算而不是按字数算，英文才不会白丢一半空间。
 */
export function clipWidth(text: string, maxWidth: number): { text: string; clipped: boolean } {
  const chars = Array.from(text)
  let width = 0
  let end = chars.length
  for (let i = 0; i < chars.length; i += 1) {
    const unit = charWidthOf(chars[i])
    if (width + unit > maxWidth) { end = i; break }
    width += unit
  }
  if (end === chars.length) return { text: text, clipped: false }
  return { text: chars.slice(0, Math.max(1, end)).join('') + '…', clipped: true }
}

/** 把任意一格按字符串收：不是字符串就当空串（后面按「缺」处理）。 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 推荐分归一化：有效数字钳到 0~10 并留一位小数（9.5 这类）。推荐分是必填项，调用方先判
 * 「是不是有限数字」，不是就整次拒绝；这里只负责钳制与取一位小数，不把缺失偷偷当成 0。
 */
function normalizePriority(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const clamped = Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, value))
  return Math.round(clamped * 10) / 10
}

/**
 * 校验并整理参数：只认 { items: [{ intro, prompt, reason, gain, cost, priority }, ...] }。
 *
 * 规矩（本票冻结，界面票照它写）：
 * - items 不是数组、少于两条、任意一条缺 intro / prompt / reason / gain / cost（trim 后为空）
 *   或缺推荐分（不是有限数字）——整次拒绝，不补编建议；
 * - 排序：按推荐分从高到低往左排，并列保持模型给的相对顺序；
 * - 多于四条——排好序之后留前四条，所以截掉的永远是分最低的；
 * - 单项文本超长——截断并补省略号，不报错。
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
    const gain = asString(rec ? rec.gain : '').trim()
    const cost = asString(rec ? rec.cost : '').trim()
    const priority = normalizePriority(rec ? rec.priority : undefined)
    if (!intro || !prompt || !reason || !gain || !cost) {
      return refuse(REFUSAL_REASONS.BAD_ARGS,
        '这次的建议里第 ' + (i + 1) + ' 条缺简介、提示词、理由、优点或缺点，我没记下任何建议：请每条都给 intro、prompt、reason、gain 与 cost 再调一次。',
        notes.concat(['bad-item:' + (i + 1)]), received)
    }
    if (priority === null) {
      return refuse(REFUSAL_REASONS.BAD_ARGS,
        '这次的建议里第 ' + (i + 1) + ' 条没给推荐分（priority），我没记下任何建议：请给每条都打一个 0 到 10 的分再调一次。',
        notes.concat(['bad-item:' + (i + 1)]), received)
    }
    const introPart = clipWidth(intro, INTRO_MAX_WIDTH)
    const promptPart = clipText(prompt, PROMPT_MAX_CHARS)
    const reasonPart = clipText(reason, REASON_MAX_CHARS)
    const gainPart = clipText(gain, GAIN_MAX_CHARS)
    const costPart = clipText(cost, COST_MAX_CHARS)
    if (introPart.clipped || promptPart.clipped || reasonPart.clipped || gainPart.clipped || costPart.clipped) clipped += 1
    valid.push({ intro: introPart.text, prompt: promptPart.text, reason: reasonPart.text, gain: gainPart.text, cost: costPart.text, priority: priority })
  }
  // 排序（Array.prototype.sort 稳定，并列保持模型给的相对顺序）：按推荐分从高到低往左排。
  // 推荐分是必填项，这里不用再处理「没打分」的分支。排好再截到上限，截掉的永远是分最低的。
  valid.sort(function (a, b) {
    return b.priority - a.priority
  })
  const items = valid.length > MAX_ITEMS ? valid.slice(0, MAX_ITEMS) : valid
  if (clipped > 0) notes.push('clipped:' + clipped)
  const text = received > MAX_ITEMS
    ? '已记下前 ' + MAX_ITEMS + ' 条下一步建议（收到 ' + received + ' 条，按推荐分从高到低留前 ' + MAX_ITEMS + ' 条）。'
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
 * 调用编号的短散列（#1420 第四项）：与界面里 suggest.call 的 callIdHash 用同一套算法
 * （src/client/statusbar/suggestFacts.ts 的 suggestHash：djb2-xor，8 位十六进制、不足补零）。
 * 两边各写一份是有意的：工具在宿主编译单元里，界面状态栏那一片叶子不进这个单元；两边算出
 * 同一个值，日志里才能把「模型调用」与「界面拿到的事件」按调用编号对上。
 * tests/verify-suggest-next-steps.ts 钉住两边对同一串编号算出的值一样。
 */
function suggestCallIdHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
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

  /**
   * 落一行轨迹：沿用既有事件 host.call 与字段白名单（工作区只记散列，会话号不进日志）。
   * callId 是这次调用的编号（平台 exec 自带）：有就记它的短散列，用来和界面 suggest.call
   * 那行的 callIdHash 对齐 —— 这是日志里分清「模型没调」与「调了但界面没拿到事件流」的关键。
   */
  function fireLog(latencyMs: number, ok: boolean, reason: string, cwd: string, callId: string): void {
    try {
      if (!log || typeof log.fire !== 'function') return
      const fields: UnknownRecord = { method: SUGGEST_TOOL_NAME, latencyMs: latencyMs, ok: ok, kind: 'deck-tool' }
      if (reason) fields.reason = reason
      const cwdHash = cwd ? hash8(cwd) : ''
      if (cwdHash) fields.cwdHash = cwdHash
      if (callId) fields.callIdHash = suggestCallIdHash(callId)
      log.fire('info', 'host.call', fields)
    } catch (e) { /* 日志坏了不影响工具给建议 */ }
  }

  async function run(exec: unknown, args: unknown): Promise<UnknownRecord> {
    const t0 = now()
    // 调用编号在 catch 里也要用（意外分支同样落轨迹），所以放在 try 外面先取。
    const callId = (exec && typeof exec === 'object') ? (exec as UnknownRecord).callId : undefined
    const callIdText = typeof callId === 'string' ? callId : ''
    try {
      const execBag = (exec && typeof exec === 'object') ? exec as UnknownRecord : {}
      const signal = execBag.signal as UnknownRecord | null | undefined
      if (signal && signal.aborted === true) {
        const ms = now() - t0
        fireLog(ms, false, 'aborted', '', callIdText)
        return shell.unsupported(SUGGEST_TOOL_NAME, 'aborted', '这次调用被中止了，没记下任何建议：需要时再调一次。', { tookMs: ms })
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        const ms = now() - t0
        fireLog(ms, false, REFUSAL_REASONS.BAD_ARGS + ':args', '', callIdText)
        return shell.unsupported(SUGGEST_TOOL_NAME, REFUSAL_REASONS.BAD_ARGS,
          '参数不是一个对象，我没法做：请按这个工具的参数说明（items 里的 intro、prompt 与 reason）重调一次。', { tookMs: ms })
      }
      const session = await sessionContextOrHeader(exec)
      if (!session.ok) {
        const ms = now() - t0
        const reason = session.reason || REFUSAL_REASONS.NO_SESSION
        fireLog(ms, false, reason, '', callIdText)
        // 正文用本工具自己的口径：九工具那句「不动任何票」是追踪器的说法，建议工具不写票。
        return shell.unsupported(SUGGEST_TOOL_NAME, reason,
          '这次没拿到当前会话的工作区目录，没法记录建议：请重调一次；一直这样就去看日志。',
          { session: { id: session.sessionId }, tookMs: ms })
      }
      const resolved = resolveSuggestItems(args)
      const ms = now() - t0
      fireLog(ms, resolved.accepted, logReasonOf(resolved), session.cwd, callIdText)
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
      fireLog(ms, false, 'threw', '', callIdText)
      return shell.unsupported(SUGGEST_TOOL_NAME, REFUSAL_REASONS.BACKEND_THREW,
        '这颗工具内部出了意外，没记下任何建议：请重调一次；一直这样就去看日志。', { tookMs: ms })
    }
  }

  return { definition: definition, run: run }
}
