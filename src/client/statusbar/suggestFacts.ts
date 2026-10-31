// src/client/statusbar/suggestFacts.ts —— 「下一步建议」取数通路里的纯函数层（#1409）
//
// 这一片只做与界面无关的账：从会话事件流里认出「这次工具调用是不是建议工具」、把工具参数的
// 原始 JSON 文本解析成界面能直接用的清单、按与工具侧同一组上下限再钳一次。它不碰 React、不碰
// DOM、不碰 sessions 服务，也不记日志 —— 所以测试可以直接喂假事件，不需要真浏览器。
//
// 契约（与仓库其它叶子文件同一套，见 scripts/build.mts 里的叶子清单）：
//   模块真源是 ESM 导出，构建时剥掉行首 export 拼进 apply 闭包；运行时不许跨文件 import；
//   不许 export default；只写可剥离的 TypeScript（不用 enum、不用构造函数参数属性）。
//
// 为什么界面侧还要再解析一遍参数：完整参数出现在 durable 的调用事件里（原生预设是 tool/call 的
//   data.arguments，模型给的原始 JSON 文本串；PTC 预设是 tool/ptc-dispatch-start 的 data.arguments，
//   平台已经解析好的结构化对象）。工具那边已经校验过一次，但界面这里拿到的是未再校验的原文或对象，
//   所以按同一组规矩再尽力一次：能救的救，救不了就整次不出结果、只记日志。

/** 建议工具的名字：界面靠它认出一条工具调用是不是「下一步建议」。必须与工具侧一致。 */
export const SUGGEST_TOOL_NAME = 'suggest_next_steps'
/** 建议条数的合法区间：少于下限整次不出结果，多于上限只留前几条。必须与工具侧一致。 */
export const SUGGEST_MIN_ITEMS = 2
export const SUGGEST_MAX_ITEMS = 4
/** 简介上限按显示宽度算：汉字、全角标点与 emoji 算 2 格，其余字符算 1 格，30 格等于 15 个汉字；
 *  英文每个字母算 1 格，所以最多 30 个字符。必须与工具侧一致。 */
export const SUGGEST_INTRO_MAX_WIDTH = 30
/** 提示词与三格理由文本都按 Unicode 码点数算，避免把 emoji 之类的代理对切坏；理由、优点、缺点
 *  各限 30 个字。必须与工具侧一致。 */
export const SUGGEST_PROMPT_MAX_CHARS = 500
export const SUGGEST_REASON_MAX_CHARS = 30
export const SUGGEST_GAIN_MAX_CHARS = 30
export const SUGGEST_COST_MAX_CHARS = 30
export const SUGGEST_PRIORITY_MIN = 0
export const SUGGEST_PRIORITY_MAX = 10

/**
 * 日志里用的短散列：8 位十六进制（djb2 变体，与内核 hash8 同一套思路。
 * 单独实现一份是为了这一层保持纯粹：测试不需要伪造全局函数，产物里也不会因为引用内核名字多出依赖）。
 */
export const suggestHash = function (text: any) {
  const value = typeof text === 'string' ? text : String(text == null ? '' : text)
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/**
 * 按 Unicode 码点截断：没超长原样返回；超长保留前上限个码点，并在末尾另加一个省略号。
 * 与工具侧 clipText 同形（#1540 口径：前上限个码点保留，省略号另加） —— 界面显示的文本长度不能比工具回执里承认的还长。
 */
export const suggestClipText = function (text: any, max: any) {
  const value = typeof text === 'string' ? text : ''
  const limit = Number(max)
  if (!Number.isFinite(limit) || limit <= 0) return { text: '', clipped: value.length > 0 }
  const chars = Array.from(value)
  if (chars.length <= limit) return { text: value, clipped: false }
  return { text: chars.slice(0, Math.max(1, limit)).join('') + '…', clipped: true }
}

/** 一个字符占的显示格数：汉字、全角标点与 emoji 算 2 格，其余（英文、数字、半角标点、空格）算 1 格。
 *  与工具侧 charWidthOf 用同一套区间，两边算出的简介截断位置才会一样。 */
const suggestCharWidthOf = function (char: any) {
  const cp = String(char).codePointAt(0) || 0
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
 * 与工具侧 clipWidth 同形（#1540 口径：省略号是超长标记、不占宽度名额），按宽度算英文才不会白丢一半空间。
 */
export const suggestClipWidth = function (text: any, maxWidth: any) {
  const value = typeof text === 'string' ? text : ''
  const limit = Number(maxWidth)
  if (!Number.isFinite(limit) || limit <= 0) return { text: '', clipped: value.length > 0 }
  const chars = Array.from(value)
  let width = 0
  let end = chars.length
  for (let i = 0; i < chars.length; i++) {
    const unit = suggestCharWidthOf(chars[i])
    if (width + unit > limit) { end = i; break }
    width += unit
  }
  if (end === chars.length) return { text: value, clipped: false }
  return { text: chars.slice(0, Math.max(1, end)).join('') + '…', clipped: true }
}

/**
 * 把工具参数解析成建议清单。只认 { items: [{ intro, prompt, reason, gain, cost, priority? }, ...] }。
 *
 * 参数有两种形态，都要收：原生预设的 tool/call 给的是模型原始 JSON 文本（字符串，要 JSON.parse）；
 * PTC 预设的 tool/ptc-dispatch-start 给的已经是解析好的对象（平台转交前解析过一遍）。两路后端
 * 条目校验口径一致，界面这层不该因为走哪条预设而表现不同。
 *
 * 这里比工具侧宽松（工具是「任一条不合格整次拒绝」，界面是「坏条目丢掉、剩下的够数就用」）：
 * 界面不承担校验职责，只在参数还算可信时把展示数据取出来；过滤后不足最少条数就整次不出结果。
 * 旧会话与回放里的事件没有 gain / cost / priority 这几格，按空串与 null 收，界面只显示有的行。
 * 返回值的 ok 是唯一稳定的成功标记；clipped 是「被截断过文本的条数」（与工具侧 counts.clipped 同口径）。
 */
export const suggestItemsOf = function (argumentsValue: any) {
  const empty = { ok: false, reason: 'bad-json', items: [] as any[], clipped: 0, dropped: 0 }
  let parsed: any = null
  if (typeof argumentsValue === 'string') {
    try { parsed = JSON.parse(argumentsValue) } catch (e) { return empty }
  } else if (argumentsValue !== null && typeof argumentsValue === 'object') {
    // 已是结构化对象时别再序列化一遍：PTC 事件里的 arguments 就是这个形态。
    parsed = argumentsValue
  } else {
    return empty
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.items)) {
    return { ok: false, reason: 'bad-shape', items: [] as any[], clipped: 0, dropped: 0 }
  }
  const raw = parsed.items as any[]
  const items: any[] = []
  let clipped = 0
  let dropped = 0
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { dropped += 1; continue }
    const promptText = typeof entry.prompt === 'string' ? entry.prompt.trim() : ''
    if (!promptText) { dropped += 1; continue }
    // 简介、理由、优点、缺点与推荐分都允许缺失：简介缺失时界面只显示提示词（旧事件里没有这一格），
    // 类型不是字符串也按空串收，不因此丢掉整条提示词；推荐分没给就记 null，浮层少「推荐分」这一行。
    const introText = typeof entry.intro === 'string' ? entry.intro.trim() : ''
    const reasonText = typeof entry.reason === 'string' ? entry.reason.trim() : ''
    const gainText = typeof entry.gain === 'string' ? entry.gain.trim() : ''
    const costText = typeof entry.cost === 'string' ? entry.cost.trim() : ''
    const introPart = suggestClipWidth(introText, SUGGEST_INTRO_MAX_WIDTH)
    const promptPart = suggestClipText(promptText, SUGGEST_PROMPT_MAX_CHARS)
    const reasonPart = suggestClipText(reasonText, SUGGEST_REASON_MAX_CHARS)
    const gainPart = suggestClipText(gainText, SUGGEST_GAIN_MAX_CHARS)
    const costPart = suggestClipText(costText, SUGGEST_COST_MAX_CHARS)
    if (introPart.clipped || promptPart.clipped || reasonPart.clipped || gainPart.clipped || costPart.clipped) clipped += 1
    items.push({ intro: introPart.text, prompt: promptPart.text, reason: reasonPart.text, gain: gainPart.text, cost: costPart.text, priority: suggestPriorityOf(entry.priority) })
  }
  // 排序（与工具侧同口径）：按推荐分从高到低；没给分的放末尾、彼此保持原有相对顺序（旧事件才会有）。
  // 排好再截到上限，所以多于上限时留下的是分最高的几条，而不是先到的几条。
  items.sort(function (a: any, b: any) {
    if (a.priority === null && b.priority === null) return 0
    if (a.priority === null) return 1
    if (b.priority === null) return -1
    return b.priority - a.priority
  })
  const kept = items.length > SUGGEST_MAX_ITEMS ? items.slice(0, SUGGEST_MAX_ITEMS) : items
  if (kept.length < SUGGEST_MIN_ITEMS) {
    return { ok: false, reason: 'too-few', items: [] as any[], clipped: clipped, dropped: dropped }
  }
  return { ok: true, reason: '', items: kept, clipped: clipped, dropped: dropped }
}

/**
 * 优先级归一化（与工具侧 normalizePriority 同口径）：有效数字钳到 0~10 并留一位小数；
 * 没给、不是数字、NaN 都当没打分（null），排最后。界面这层只做展示排序，不拒绝任何条目。
 */
const suggestPriorityOf = function (value: any) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const clamped = Math.min(SUGGEST_PRIORITY_MAX, Math.max(SUGGEST_PRIORITY_MIN, value))
  return Math.round(clamped * 10) / 10
}

/**
 * 从一条事件里认出取数通路关心的三种东西：
 *   - 建议工具的一次调用：{ kind: 'call', turn, callId, argumentsValue }。原生预设走 durable
 *     tool/call（带轮次，参数是 JSON 文本）；PTC 预设走 tool/ptc-dispatch-start（事件本身不带
 *     轮次，turn 为 null，由订阅层从 turn/start 补齐；参数已是对象）。
 *   - 一轮的开始：{ kind: 'turn-start', turn }（给 PTC 调用补轮次用）。
 *   - 一轮的结束：{ kind: 'turn-end', turn }（用来判断「这轮跑完了没有」）。
 * 其它事件（含 assistant/live-chunk 里同一次调用的流式增量、工具结果事件）一律返回 null ——
 * 完整参数只在 durable 的调用事件里，且一次调用只能认一次。
 */
export const suggestEventOf = function (event: any) {
  if (!event || typeof event !== 'object') return null
  const data = event.data
  if (!data || typeof data !== 'object') return null
  if (event.type === 'tool/call') {
    if (typeof data.name !== 'string' || data.name !== SUGGEST_TOOL_NAME) return null
    if (typeof data.callId !== 'string' || !data.callId) return null
    const callTurn = Number(data.turn)
    if (!Number.isFinite(callTurn)) return null
    return { kind: 'call', turn: callTurn, callId: data.callId, argumentsValue: data.arguments }
  }
  if (event.type === 'tool/ptc-dispatch-start') {
    if (typeof data.name !== 'string' || data.name !== SUGGEST_TOOL_NAME) return null
    if (typeof data.subCallId !== 'string' || !data.subCallId) return null
    return { kind: 'call', turn: null, callId: data.subCallId, argumentsValue: data.arguments }
  }
  if (event.type === 'turn/start') {
    const startTurn = Number(data.turn)
    if (!Number.isFinite(startTurn)) return null
    return { kind: 'turn-start', turn: startTurn }
  }
  if (event.type === 'turn/end') {
    const endTurn = Number(data.turn)
    if (!Number.isFinite(endTurn)) return null
    return { kind: 'turn-end', turn: endTurn }
  }
  return null
}
