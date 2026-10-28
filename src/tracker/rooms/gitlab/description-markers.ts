/**
 * rooms/gitlab/description-markers.ts —— 票面正文文件头的标记，读写共用同一套形状。
 *
 * 为什么单立一份：归属与阻塞的回退写法都是正文里的一行字，读法写法必须成对出现，
 * 改一边另一边跟着改。写侧只加不删、读侧按时间猜，就是因为两边各写一遍。
 * 本文件只做纯字符串变换，不碰契约类型。组合进归一与重导出留在 normalize，
 * 调用方的引用路径不用动。
 *
 * 两套标记：
 *   归属是隐藏标记（子票归属的唯一真相，新写的票都是它），旧可见行只在过渡期回退认，不再写。
 *   阻塞成对写：可见行给人读，隐藏表给程序读，一次写齐，读侧隐藏优先。
 * 口径：只认文件头，即第一个标题之前那一段，没有标题时只看前十行，正文里的不算。
 * 两处任一处改口径，另一处与共享包 marker.ts 必须跟着改。
 */
// 子票归属的唯一真相：文件头里的隐藏标记 `<!-- DSH-PARENT: <地图号> -->`（#1599 起，
// 2026-10-28 拍板于 #1176：可见的 `Part of #<地图号>` 声明行退役，只在过渡期回退认）。
// 为什么藏起来：可见行有个改不掉的毛病——正文中间手写一句 `Part of #99`（举例、引用别人的票面）
// 会被读成归属；隐藏标记只认文件头（第一个标题之前，没有标题时只看前 10 行，与共享包 marker.ts
// 的 markerKindInHeader 同一口径），正文里的不算。命名空间 `DSH-` 让误伤只可能来自故意手写同一标记的人。
// HTML 注释在 GitLab 里能活：幂等锚 `<!-- DSH-IDEMPOTENCY-KEY: ... -->` 本来就是同一形状，建票写进
// description、回查从票面读回来（idempotency.ts），注释 round-trip 是已经验证过的机制，不是新假设。
// 为什么不再看 links：`relates_to` 是对称的平级关联，列表行里分不出哪一头是父；
// 按时间取最早一条是猜，不是读。旧的 `Parent: #iid` 自造关键词一并退役：没有任何模板会写它。
const HIDDEN_PARENT_RE = /^<!--\s*DSH-PARENT\s*:\s*(\d+)\s*-->$/;
// 旧 `Part of` 行的认法（只剩过渡期回退认，不再写）：同样只认文件头，正文中间手写的不算。
const LEGACY_PART_OF_RE = /^Part of #(\d+)\s*$/
// 幂等锚的行首形状（idempotency-keys.ts 的 IDEMPOTENCY_MARKER_PREFIX）：写归属行时跳过它们，
// 锚永远是文件头第一批行。只认行首不认个数，重试键不同攒下多行锚也照样跳过。
const ANCHOR_LINE_RE = /^\s*<!--\s*DSH-IDEMPOTENCY-KEY\s*:/

/**
 * 取正文的“文件头”：第一个 `#` 标题之前那一段；没有标题时只看前 10 行。
 * 口径与共享包 marker.ts 的 markerKindInHeader 同一处：标记是文件元数据，写在标题之前；
 * 正文里举例提到同一写法时不算数。两处任一处改口径，另一处必须跟着改。
 */
function headerOf(body: string): string {
  const h = /^#+\s+/m.exec(body)
  if (h && typeof h.index === 'number') return body.slice(0, h.index)
  return body.split('\n').slice(0, 10).join('\n')
}

/** 文件头里有没有隐藏归属标记；有返回地图号，没有返回 null（正文里的不算）。 */
export function parseHiddenParent(body: unknown): string | null {
  if (typeof body !== 'string' || !body) return null
  const lines = headerOf(body).split('\n')
  for (const line of lines) {
    const m = HIDDEN_PARENT_RE.exec(line.trim())
    if (m) return m[1] as string
  }
  return null
}

/** 过渡期回退认：文件头里的旧 `Part of #<号>` 行；新写的票不再有这一行，读到就该顺手迁走。 */
export function parseLegacyPartOf(body: unknown): string | null {
  if (typeof body !== 'string' || !body) return null
  const lines = headerOf(body).split('\n')
  for (const line of lines) {
    const m = LEGACY_PART_OF_RE.exec(line.trim())
    if (m) return m[1] as string
  }
  return null
}

/** 建出隐藏归属标记那一行（渲染后看不见，读回来还是原文）。 */
function buildHiddenParentLine(mapKey: string): string {
  return `<!-- DSH-PARENT: ${mapKey} -->`
}

/**
 * 把隐藏归属标记写进文件头（幂等：重复行一次清干净；旧 `Part of` 行顺手置换掉，不新增可见行）。
 * 传 null 表示拆掉标记（其余正文一个字不动，只删行）。
 *
 * 行位置：幂等锚之后、其余正文之前——与 marker.ts“锚之后、一级标题之前”同一习惯，锚回查不受影响。
 * 删法是按行过滤全文：散在正文中间的旧行与误写的标记行一并清掉，免得下次读回来认错。
 */
export function rewriteDescriptionWithHiddenParent(oldBody: string | null | undefined, mapKey: string | null): string {
  const lines = String(oldBody || '').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (HIDDEN_PARENT_RE.test(t)) continue
    if (LEGACY_PART_OF_RE.test(t)) continue
    kept.push(line)
  }
  while (kept.length > 0 && kept[0].trim() === '') kept.shift()
  if (mapKey === null) return kept.join('\n')
  const line = buildHiddenParentLine(String(mapKey))
  let at = 0
  while (at < kept.length && ANCHOR_LINE_RE.test(kept[at])) at++
  kept.splice(at, 0, line)
  return kept.join('\n')
}

// 阻塞机器表： `<!-- DSH-BLOCKED-BY: 12, 13 -->`，独占一行、只认文件头（与归属标记同一口径，#1599）。
// 人读的那一行 `Blocked by: #12, #13` 照旧保留：隐藏表是程序读的，可见行是人读的，写侧成对维护
// （rewriteDescriptionWithBlockedPair），读侧隐藏优先——人手改了可见行没改表时程序按表走，不猜。
const HIDDEN_BLOCKED_RE = /^<!--\s*DSH-BLOCKED-BY\s*:\s*(.*?)\s*-->$/;
const VISIBLE_BLOCKED_ANY_RE = /^Blocked by:\s*.+$/m;

/** 文件头里的阻塞机器表；没有这一行返回 null（区别于“有行但是空的”），空行返回 []。 */
export function parseHiddenBlockedBy(body: unknown): string[] | null {
  if (typeof body !== 'string' || !body) return null
  const lines = headerOf(body).split('\n')
  for (const rawLine of lines) {
    const m = HIDDEN_BLOCKED_RE.exec(rawLine.trim())
    if (!m) continue
    const inner = (m[1] as string).trim()
    if (!inner) return []
    const out: string[] = []
    const seen = new Set<string>()
    const parts = inner.split(/[\s,]+/)
    for (const part of parts) {
      const key = part.replace(/^#/, '').trim()
      if (!/^\d+$/.test(key) || seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
    return out
  }
  return null
}

/** 建出阻塞机器表那一行（空集时值留空；调用方一般直接删行，这里只管拼）。 */
function buildHiddenBlockedLine(keys: string[]): string {
  return `<!-- DSH-BLOCKED-BY:${keys.length > 0 ? ' ' + keys.join(', ') : ''} -->`
}

/**
 * 阻塞成对写：可见 `Blocked by:` 行（人读）与隐藏机器表（程序读）一次写齐。
 * 空集表示拆掉两处（可见行只动第一处，正文别处的原文不动；机器表全文清掉重建）。
 * 新行插进文件头（锚与归属标记之后），不扔到正文中间；已有可见行就在它后面紧跟机器表，
 * 原文里两行挨着，人一看就知道是一对。
 */
export function rewriteDescriptionWithBlockedPair(oldBody: string | null | undefined, keys: string[]): string {
  const wanted: string[] = [...new Set((Array.isArray(keys) ? keys : []).map(String).filter(Boolean))]
  const body = String(oldBody || '')
  // 机器表全文清掉重建；可见行沿用旧口径（只动第一处），免得把正文别处的原文当残留删掉。
  const cleared = body.split('\n').filter((line) => !HIDDEN_BLOCKED_RE.test(line.trim())).join('\n')
  if (wanted.length === 0) {
    if (!VISIBLE_BLOCKED_ANY_RE.test(cleared)) return cleared
    return cleared.replace(VISIBLE_BLOCKED_ANY_RE, '').replace(/^\n+/, '')
  }
  const visible = `Blocked by: ${wanted.map((k) => '#' + k).join(', ')}`
  const hidden = buildHiddenBlockedLine(wanted)
  if (VISIBLE_BLOCKED_ANY_RE.test(cleared)) return cleared.replace(VISIBLE_BLOCKED_ANY_RE, visible + '\n' + hidden)
  const lines = cleared.split('\n')
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  let at = 0
  while (at < lines.length && (ANCHOR_LINE_RE.test(lines[at]) || HIDDEN_PARENT_RE.test(lines[at].trim()))) at++
  lines.splice(at, 0, visible, hidden)
  return lines.join('\n')
}
