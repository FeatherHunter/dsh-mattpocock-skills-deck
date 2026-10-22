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
// 为什么界面侧还要再解析一遍参数：完整参数只出现在 durable tool/call 事件里（data.arguments），
//   平台交给浏览器的是模型给的原始 JSON 文本串，不是结构化对象。工具那边已经校验过一次，但
//   界面这里拿到的是原文，所以按同一组规矩再尽力一次：能救的救，救不了就整次不出结果、只记日志。

/** 建议工具的名字：界面靠它认出一条工具调用是不是「下一步建议」。必须与工具侧一致。 */
export const SUGGEST_TOOL_NAME = 'suggest_next_steps'
/** 建议条数的合法区间：少于下限整次不出结果，多于上限只留前几条。必须与工具侧一致。 */
export const SUGGEST_MIN_ITEMS = 2
export const SUGGEST_MAX_ITEMS = 4
/** 单项文本上限：按 Unicode 码点数算，避免把 emoji 之类的代理对切坏。必须与工具侧一致。 */
export const SUGGEST_PROMPT_MAX_CHARS = 500
export const SUGGEST_REASON_MAX_CHARS = 200

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
 * 按 Unicode 码点截断：没超长原样返回；超长切到上限以内并在末尾补一个省略号。
 * 与工具侧 clipText 同形 —— 界面显示的文本长度不能比工具回执里承认的还长。
 */
export const suggestClipText = function (text: any, max: any) {
  const value = typeof text === 'string' ? text : ''
  const limit = Number(max)
  if (!Number.isFinite(limit) || limit <= 0) return { text: '', clipped: value.length > 0 }
  const chars = Array.from(value)
  if (chars.length <= limit) return { text: value, clipped: false }
  return { text: chars.slice(0, Math.max(1, limit - 1)).join('') + '…', clipped: true }
}

/**
 * 把工具参数原文解析成建议清单。只认 { items: [{ prompt, reason }, ...] }。
 *
 * 这里比工具侧宽松（工具是「任一条不合格整次拒绝」，界面是「坏条目丢掉、剩下的够数就用」）：
 * 界面不承担校验职责，只在参数还算可信时把展示数据取出来；过滤后不足最少条数就整次不出结果。
 * 返回值的 ok 是唯一稳定的成功标记；clipped 是「被截断过文本的条数」（与工具侧 counts.clipped 同口径）。
 */
export const suggestItemsOf = function (argumentsText: any) {
  const empty = { ok: false, reason: 'bad-json', items: [] as any[], clipped: 0, dropped: 0 }
  if (typeof argumentsText !== 'string') return { ok: false, reason: 'bad-json', items: [] as any[], clipped: 0, dropped: 0 }
  let parsed: any = null
  try { parsed = JSON.parse(argumentsText) } catch (e) { return { ok: false, reason: 'bad-json', items: [] as any[], clipped: 0, dropped: 0 } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.items)) {
    return { ok: false, reason: 'bad-shape', items: [] as any[], clipped: 0, dropped: 0 }
  }
  const raw = parsed.items as any[]
  const items: any[] = []
  let clipped = 0
  let dropped = 0
  for (let i = 0; i < raw.length && items.length < SUGGEST_MAX_ITEMS; i++) {
    const entry = raw[i]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { dropped += 1; continue }
    const promptText = typeof entry.prompt === 'string' ? entry.prompt.trim() : ''
    if (!promptText) { dropped += 1; continue }
    // 理由允许缺失（界面按空串展示），但类型不是字符串时也按空串收，不因此丢掉整条提示词。
    const reasonText = typeof entry.reason === 'string' ? entry.reason.trim() : ''
    const promptPart = suggestClipText(promptText, SUGGEST_PROMPT_MAX_CHARS)
    const reasonPart = suggestClipText(reasonText, SUGGEST_REASON_MAX_CHARS)
    if (promptPart.clipped || reasonPart.clipped) clipped += 1
    items.push({ prompt: promptPart.text, reason: reasonPart.text })
  }
  if (items.length < SUGGEST_MIN_ITEMS) {
    return { ok: false, reason: 'too-few', items: [] as any[], clipped: clipped, dropped: dropped }
  }
  return { ok: true, reason: '', items: items, clipped: clipped, dropped: dropped }
}

/**
 * 从一条事件里认出取数通路关心的两种东西：
 *   - 建议工具的一次调用：{ kind: 'call', turn, callId, argumentsText }；
 *   - 一轮的结束：{ kind: 'turn-end', turn }（用来判断「这轮跑完了没有」）。
 * 其它事件（含 assistant/live-chunk 里同一次调用的流式增量）一律返回 null —— 完整参数只在
 * durable tool/call 里，流式增量只用于界面渲染，不参与取数。
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
    return { kind: 'call', turn: callTurn, callId: data.callId, argumentsText: data.arguments }
  }
  if (event.type === 'turn/end') {
    const endTurn = Number(data.turn)
    if (!Number.isFinite(endTurn)) return null
    return { kind: 'turn-end', turn: endTurn }
  }
  return null
}
