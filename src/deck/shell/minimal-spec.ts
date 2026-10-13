// src/deck/shell/minimal-spec.ts —— 七个 deck_* 工具共用的「强制最小规范」（必备标签、进度区、幂等锚）
//
// 本文件由 src/shared/deck-tools/plan.js 拆出（地图01 #1019 机械搬家），#1035 转 TypeScript，行为一字未改。

// 这个文件回答两个问题，都只有一处答案：
//   一、工具写票时「最少要保证什么」：必备标签、进度区（地图是五个区块）、幂等锚。AI 记不住这些，
//       由代码保证，并且把「我替你加了什么」原话写回返回值里。
//   二、七个工具怎么装到一起：装配口 createDeckTools 只收「七个工具工厂」这一个参数，
//       不 import 任何一个工具文件 —— 因为仓库的同层互引门禁（tests/verify-dependency-rules.ts）
//       既不许 host 层的文件互相引用，也不许 shared 层的文件互相引用。真正把七个文件读进来、
//       与宿主闸接线的那一步由接线票做（见交付报告里「需要统筹者接的那一行」）。
//
// 本文件自己不 import 任何东西（同上：共享层不许互相引用），所以下面自带两个最小的字符串工具函数；
// shell.js 里也有一份，两份都只有一行，是这条门禁下最省的写法。

/** 票的种类（deck_issue_create 的 kind 参数与各工具的写路径共用这一套词）。 */
export type DeckKind = 'map' | 'task' | 'bug'

/** 拿不准是不是字符串时统一收口成字符串：不是字符串就当空串（调用方各自判空）。 */
function str(v: unknown): string { return (typeof v === 'string') ? v : '' }

/** 强制最小规范里那几枚必备标签：按票的种类给，缺的补上，已经有的不动。 */
export const MINIMAL_LABELS: Readonly<Record<DeckKind, readonly string[]>> = Object.freeze({
  map: Object.freeze(['wayfinder:map']),
  task: Object.freeze(['wayfinder:task']),
  bug: Object.freeze(['bug', 'needs-triage']),
})

/** 地图那张票必带的五个区块（与共享层 parser.js 的 parseMapBody 认的五个标题逐字一致）。 */
export const MAP_BLOCK_TITLES = Object.freeze(['Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope'])

/** 把各种形态的标签清单（字符串、{name} 对象、两种混着来）归一成去空后的名字数组。 */
function labelNames(list: unknown): string[] {
  return (Array.isArray(list) ? list : []).map((l) => (typeof l === 'string' ? l : (l && l.name) || '')).map((s) => String(s).trim()).filter(Boolean)
}

/** 补必备标签：返回补完的清单与「我替你补了哪些」（原话写进返回值，让人看得见）。 */
export function ensureLabels(labels: unknown, kind: string): { labels: string[]; added: string[] } {
  const have = labelNames(labels)
  // kind 是运行时来的字符串：认得的那三种各有一套必备标签，认不出的一律按 task（老写法同此）。
  const want = MINIMAL_LABELS[kind as DeckKind] || MINIMAL_LABELS.task
  const added: string[] = []
  for (const name of want) {
    if (have.map((n) => n.toLowerCase()).indexOf(name.toLowerCase()) < 0) { have.push(name); added.push(name) }
  }
  return { labels: have, added: added }
}

/**
 * 补正文：地图补五个区块，别的票补一个进度区。
 * 判据是「正文里有没有认得出的那一行」，不是「有没有非空正文」——空正文照样要补。
 */
export function ensureBody(body: unknown, kind: string): { body: string; added: string[] } {
  const text = typeof body === 'string' ? body : ''
  const added: string[] = []
  let out = text
  if (kind === 'map') {
    const missing = MAP_BLOCK_TITLES.filter((t) => !new RegExp('^##\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm').test(text))
    if (missing.length) {
      if (!out.trim()) out = '<!-- 这张地图的正文由 deck_map_plan_create 建骨架时补上 -->'
      out = out.replace(/\s*$/, '') + '\n' + missing.map((t) => '\n## ' + t + '\n').join('')
      for (const t of missing) added.push('## ' + t)
    }
    return { body: out, added: added }
  }
  // 进度标题与写进度的人认同一套：「## 进度」与「## 进度：80% / ## Progress: 40%」都算有进度区，否则带百分比的票会被再插一段重复的进度区（#908）。
  if (!/^##\s*(?:进度|Progress)(?:\s*[：:]\s*\d{1,3}\s*%?)?\s*$/m.test(text)) {
    out = (out.replace(/\s*$/, '') + '\n\n## 进度\n\n<!-- 做到哪一步了，在这里一行一行记 -->\n').replace(/^\n+/, '')
    added.push('## 进度')
  }
  return { body: out, added: added }
}

/**
 * 整份还是片段：自带一级标题、幂等锚、字段行或骨架标题 = 整份，建票与改正文共用同一条判据（#1002）。
 *
 * 为什么四条都算整份：读回给的是整份票文件文本，写路径必须用同一条判据认出它，否则读回原样写回会写坏。
 * 只认一级标题或锚不够：改正文的实测里出现过无一级标题但带字段行的整份（C5），建票的实测里出现过
 * 只带骨架的正文（C2），它们按片段走都会翻倍或丢东西。片段里正常不会出现这四种写法，误伤的可能很小。
 * 本文件不引用别的共享文件（同层互引门禁），所以正則式在这里自带一份，与后端的用法逐字一致。
 * 房规注：Markdown 房内 parse.js 里有一份逐字相同的写法给建票与改正文同房引用（房规不许后端引用
 * 共享层的 deck-tools 目录，所以两份各自手写，改一处必须改另一处）。
 */
export function isWholeIssueBody(body: unknown): boolean {
  const t = typeof body === 'string' ? body : ''
  if (/^\s*#\s+\S/m.test(t)) return true
  if (/^\s*<!--[ \t]*DSH-IDEMPOTENCY-KEY:/m.test(t)) return true
  if (/^\s*(Status|Type|Blocked\s+by|Labels)\s*[:\uFF1A]/im.test(t)) return true
  if (/^\s*##\s*(Comments|Answer)\s*$/im.test(t)) return true
  return false
}

/**
 * 幂等锚：同一个会话 + 同一个标题 + 同一批标签，在同一个 5 分钟窗口里重复调一次，复用同一张票
 *（票面「写操作轻量幂等：同标题 + 同标签 5 分钟内复用」）。窗口把「重试」与「故意再建一张」分开：
 * 5 分钟之内是同一次意图的重试，之外是新的一次。锚本身交给契约层（#711）去回查，工具不自己记表。
 */
export function anchorKeyFor(parts: unknown): string {
  // 纯类型断言：取法一个字没变（少了这一句，编译器不让在未知值上读字段）。
  const p = (parts || {}) as Record<string, unknown>
  const windowMs = (typeof p.windowMs === 'number' && p.windowMs > 0) ? p.windowMs : 300000
  const bucket = Math.floor(((typeof p.now === 'number' && isFinite(p.now)) ? p.now : Date.now()) / windowMs)
  const raw = [str(p.tool), str(p.sessionId) || str(p.workspaceKey), str(p.title), labelNames(p.labels).join(','), String(bucket)].join('|')
  let h = 5381
  for (let i = 0; i < raw.length; i++) h = (((h << 5) + h + raw.charCodeAt(i)) >>> 0)
  return 'deck-' + ('0000000' + h.toString(16)).slice(-8) + '-' + bucket
}
