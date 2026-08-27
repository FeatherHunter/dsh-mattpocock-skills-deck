/**
 * client/kernel/link.js — 客户端 URL 契约 helper（#227 引入 · #231 模板化重写 · 清尾批终态）。
 *
 * 真源链：后端模块声明 links.{issueUrlTemplate,repoUrlTemplate,searchUrlTemplate,linkPatternSource}
 * → wf.registry / 快照 backendModules 双通道透传 → 本文件按模板渲染，**零 backendId 分支、零品牌 URL 字面量**。
 * 元数据未达（旧宿主/极早窗口）：返回空串 —— 诚实缺该形态（D8：markdown '' UI 按空不渲染；同理适用于一切无据可依场景）。
 */
function __sel(st) { return st && (st.selection || (st.snapshot && st.snapshot.selection)) }
function __backendId(st) { const s = __sel(st); return s ? s.backendId : null }
function __refIdOf(st) {
  const repo = st && st.snapshot && (st.snapshot.repository || st.snapshot.repo)
  const repo2 = st && st.repository
  if (repo && typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (repo && repo.owner && repo.name) return repo.owner + '/' + repo.name
  if (repo2 && typeof repo2.refId === 'string' && repo2.refId) return repo2.refId
  if (repo2 && repo2.owner && repo2.name) return repo2.owner + '/' + repo2.name
  return ''
}
function __metaLinks(st) {
  const bid = __backendId(st)
  if (bid == null) return null
  const ms = st && st.backendModules
  if (!Array.isArray(ms)) return null
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i]
    if (m && m.id === bid && m.links && typeof m.links === 'object') return m.links
  }
  return null
}
/** 各后端 links.linkPatternSource 的可用来源：本会话快照优先，回退全局共享缓存。 */
function __patternSources(st) {
  const out = []
  const ms = (st && Array.isArray(st.backendModules)) ? st.backendModules
    : ((typeof shared !== 'undefined' && shared && Array.isArray(shared.backendModules)) ? shared.backendModules : null)
  if (ms) for (let i = 0; i < ms.length; i++) {
    const m = ms[i]
    if (m && m.links && m.links.linkPatternSource) out.push(String(m.links.linkPatternSource))
  }
  return out
}
export const issueUrlFor = (st, key) => {
  const n = String(key || '').trim()
  if (!n) return ''
  const meta = __metaLinks(st)
  if (!meta) return ''
  const tpl = String(meta.issueUrlTemplate || '')
  if (!tpl) return ''
  const refId = __refIdOf(st)
  if (!refId) return ''
  return tpl.split('{refId}').join(refId).split('{key}').join(n)
}
export const searchUrlFor = (st, name) => {
  const n = String(name || '').trim()
  if (!n) return ''
  const meta = __metaLinks(st)
  if (!meta) return ''
  const tpl = String(meta.searchUrlTemplate || '')
  if (!tpl) return ''
  return tpl.split('{q}').join(encodeURIComponent(n))
}
export const repoUrlFor = (st) => {
  // 宿主 describe 产出的 url 是权威值：任何后端、只要给 url 就直用
  const repoFirst = st && (st.snapshot && (st.snapshot.repository || st.snapshot.repo))
  if (repoFirst && repoFirst.url) return repoFirst.url
  const meta = __metaLinks(st)
  if (!meta) return ''
  const tpl = String(meta.repoUrlTemplate || '')
  if (!tpl) return ''
  const refId = __refIdOf(st)
  if (!refId) return ''
  return tpl.split('{refId}').join(refId)
}
/** 新会话锚点/提及识别（#231 清尾终态）：扫描式样只来自各后端 links.linkPatternSource 声明；无数据 → 无识别（诚实）。 */
export function issueRefNumbersFrom(text, st) {
  const s = String(text || '')
  if (!s) return []
  const srcs = __patternSources(st)
  if (!srcs.length) return []
  const out = []
  const have = {}
  for (let k = 0; k < srcs.length; k++) {
    try {
      const re = new RegExp(srcs[k], 'g')
      let m
      while ((m = re.exec(s)) !== null) { const n = Number(m[1]); if (!have[n]) { have[n] = true; out.push(n) } }
    } catch (e) {}
  }
  return out
}
