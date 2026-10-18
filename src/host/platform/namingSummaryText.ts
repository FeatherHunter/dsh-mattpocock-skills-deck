// src/host/platform/namingSummaryText.ts —— 命名摘要的纯文本函数（#1255 从 namingSummary.ts 拆出）
//
// 为什么单列：取文本、选首轮、取路由、洗标题这四件事是纯的 —— 不碰会话、不记状态、不调模型，
// 给什么回什么；编排（幂等、终局去重、瞬败退避、直达）是有状态的，两边的变化原因不同，
// 测试策略也不同（纯函数可直接断言，编排要注夹具）。拆出来之后 namingSummary.ts 只做编排，
// 跨文件边只有一条（namingSummary → 本文件，被依赖方），反向不依赖。
//
// 口径（从 namingSummary.ts 原样搬来，行为一字未动）：
//   · 消息形状按底座三态容错：字符串 / content 块数组 / text 字段；
//   · 首轮只认第一段用户消息与第一段助手消息（assistant/attempt 是过程态，不算）；
//   · 标题取首行十字以内，首尾引号与括号一律剥掉。

// 从一条消息记录里取纯文本（形状按底座三态容错：字符串 / content 块数组 / text 字段）。
export function textOfMessage(m: any): string {
  try {
    if (typeof m === 'string') return m
    if (!m || typeof m !== 'object') return ''
    if (Array.isArray(m.content)) {
      let out = ''
      for (let i = 0; i < m.content.length; i++) {
        const b = m.content[i]
        if (b && b.type === 'text' && typeof b.text === 'string') out += b.text
      }
      return out
    }
    if (typeof m.text === 'string') return m.text
    return ''
  } catch (e) { return '' }
}

// 按 seq 取首个用户段与首个助手段全文（assistant/attempt 是过程态，不算第一段）。
export function pickFirstExchange(events: any): { user: string; asst: string } | null {
  if (!Array.isArray(events)) return null
  const ordered = events.slice().sort(function (a: any, b: any) { return (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0) })
  let user = '', asst = ''
  for (let i = 0; i < ordered.length; i++) {
    const ev = ordered[i]
    if (!ev || typeof ev.type !== 'string') continue
    if (!user && ev.type === 'user/message') user = textOfMessage(ev.data)
    else if (!asst && ev.type === 'assistant/message' && ev.data && typeof ev.data === 'object') asst = textOfMessage(ev.data.message)
    if (user && asst) break
  }
  return { user: user, asst: asst }
}

// 取该会话最新请求头里的路由（provider/model），与底座标题包同口径（无则返回 null）。
export function latestRoute(events: any): { provider: string; model: string } | null {
  if (!Array.isArray(events)) return null
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (!ev || ev.type !== 'request/header' || !ev.data || typeof ev.data !== 'object') continue
    const h = ev.data.header && typeof ev.data.header === 'object' ? ev.data.header : ev.data
    const provider = h.provider, model = h.model
    if (typeof provider === 'string' && provider && typeof model === 'string' && model) {
      return { provider: provider, model: model }
    }
  }
  return null
}

export function cleanSummaryText(s: unknown): string {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  t = t.replace(/^["'「『“‘（(\[«‹]+/, '').replace(/["'」』”’）)\]»›]+$/, '').trim()
  if (t.length > 10) t = t.slice(0, 10).trim()
  return t
}
