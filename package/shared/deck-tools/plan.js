// src/shared/deck-tools/plan.js —— 七个 deck_* 工具共用的「强制最小规范」与装配口（#713 第六批）
//
// 这个文件回答两个问题，都只有一处答案：
//   一、工具写票时「最少要保证什么」：必备标签、进度区（地图是五个区块）、幂等锚。AI 记不住这些，
//       由代码保证，并且把「我替你加了什么」原话写回返回值里。
//   二、七个工具怎么装到一起：装配口 createDeckTools 只收「七个工具工厂」这一个参数，
//       不 import 任何一个工具文件 —— 因为仓库的同层互引门禁（tests/verify-no-same-layer-import.js）
//       既不许 host 层的文件互相引用，也不许 shared 层的文件互相引用。真正把七个文件读进来、
//       与宿主闸接线的那一步由接线票做（见交付报告里「需要统筹者接的那一行」）。
//
// 本文件自己不 import 任何东西（同上：共享层不许互相引用），所以下面自带两个最小的字符串工具函数；
// shell.js 里也有一份，两份都只有一行，是这条门禁下最省的写法。
function str(v) { return (typeof v === 'string') ? v : '' }

/** 强制最小规范里那几枚必备标签：按票的种类给，缺的补上，已经有的不动。 */
export const MINIMAL_LABELS = Object.freeze({
  map: Object.freeze(['wayfinder:map']),
  task: Object.freeze(['wayfinder:task']),
  bug: Object.freeze(['bug', 'needs-triage']),
})

/** 地图那张票必带的五个区块（与共享层 parser.js 的 parseMapBody 认的五个标题逐字一致）。 */
export const MAP_BLOCK_TITLES = Object.freeze(['Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope'])

function labelNames(list) {
  return (Array.isArray(list) ? list : []).map((l) => (typeof l === 'string' ? l : (l && l.name) || '')).map((s) => String(s).trim()).filter(Boolean)
}

/** 补必备标签：返回补完的清单与「我替你补了哪些」（原话写进返回值，让人看得见）。 */
export function ensureLabels(labels, kind) {
  const have = labelNames(labels)
  const want = MINIMAL_LABELS[kind] || MINIMAL_LABELS.task
  const added = []
  for (const name of want) {
    if (have.map((n) => n.toLowerCase()).indexOf(name.toLowerCase()) < 0) { have.push(name); added.push(name) }
  }
  return { labels: have, added: added }
}

/**
 * 补正文：地图补五个区块，别的票补一个进度区。
 * 判据是「正文里有没有认得出的那一行」，不是「有没有非空正文」——空正文照样要补。
 */
export function ensureBody(body, kind) {
  const text = typeof body === 'string' ? body : ''
  const added = []
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
  if (!/^##\s*进度\s*$/m.test(text)) {
    out = (out.replace(/\s*$/, '') + '\n\n## 进度\n\n<!-- 做到哪一步了，在这里一行一行记 -->\n').replace(/^\n+/, '')
    added.push('## 进度')
  }
  return { body: out, added: added }
}

/**
 * 幂等锚：同一个会话 + 同一个标题 + 同一批标签，在同一个 5 分钟窗口里重复调一次，复用同一张票
 *（票面「写操作轻量幂等：同标题 + 同标签 5 分钟内复用」）。窗口把「重试」与「故意再建一张」分开：
 * 5 分钟之内是同一次意图的重试，之外是新的一次。锚本身交给契约层（#711）去回查，工具不自己记表。
 */
export function anchorKeyFor(parts) {
  const p = parts || {}
  const windowMs = (typeof p.windowMs === 'number' && p.windowMs > 0) ? p.windowMs : 300000
  const bucket = Math.floor(((typeof p.now === 'number' && isFinite(p.now)) ? p.now : Date.now()) / windowMs)
  const raw = [str(p.tool), str(p.sessionId) || str(p.workspaceKey), str(p.title), labelNames(p.labels).join(','), String(bucket)].join('|')
  let h = 5381
  for (let i = 0; i < raw.length; i++) h = (((h << 5) + h + raw.charCodeAt(i)) >>> 0)
  return 'deck-' + ('0000000' + h.toString(16)).slice(-8) + '-' + bucket
}

/** 七个工具的装配顺序（描述都很短：详细语义在 deck_context 的返回值里，不进系统提示）。 */
export const DECK_TOOL_ORDER = Object.freeze([
  'deck_context', 'deck_issue_get', 'deck_map_snapshot', 'deck_issue_create', 'deck_map_plan_create', 'deck_map_link', 'deck_issue_patch',
])

/**
 * 把七个工具装成一张表：{ name → { definition, run } }。
 * factories 是七个工具工厂的数组（由接线方 import 进来后传进去）；缺哪个就少哪个，
 * 缺的会被如实列在 returned.missing 里，不补一个假的桩 —— 工具要么真能用，要么不在表里。
 */
export function createDeckTools(factories, deps) {
  const d = deps || {}
  const built = {};
  const missing = []
  for (const f of (Array.isArray(factories) ? factories : [])) {
    try {
      const tool = (typeof f === 'function') ? f(d.toolDeps || {}) : f
      if (tool && tool.definition && typeof tool.run === 'function') built[tool.definition.name] = tool
    } catch (e) { /* 一个工具装不起来不影响其它六个；缺谁由下面的 missing 说出来 */ }
  }
  const names = DECK_TOOL_ORDER.filter((n) => built[n])
  for (const n of DECK_TOOL_ORDER) if (!built[n]) missing.push(n)
  return { tools: built, names: names, definitions: names.map((n) => built[n].definition), missing: missing }
}
