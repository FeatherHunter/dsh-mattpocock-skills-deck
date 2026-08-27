/**
 * client/kernel/link.js — 客户端 URL 契约 helper（#227 引入 · #231 模板化重写）。
 *
 * 真源链：后端模块声明 links.{issueUrlTemplate,repoUrlTemplate,searchUrlTemplate}
 * → wf.registry / 快照 backendModules 双通道透传 → 本文件按模板渲染，**零 backendId 分支**。
 * 后端已开口（快照里有该后端的 links 元数据）就信它：空模板 = 诚实「无链接」。
 * 仅当快照元数据完全未达（旧宿主/独立导入等窗口期）才落入文末 LEGACY 映射；
 * 该映射是本文件唯一的品牌字面量落点（tests/verify-client-hardcode-gate.js 白名单内），由清尾批随宿主一致窗口删除。
 */
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
  const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
  const bid = sel ? sel.backendId : null
  if (bid == null) return null
  const ms = st && st.backendModules
  if (!Array.isArray(ms)) return null
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i]
    if (m && m.id === bid && m.links && typeof m.links === 'object') return m.links
  }
  return null
}
export const issueUrlFor = (st, key) => {
  const n = String(key || '').trim()
  if (!n) return ''
  const meta = __metaLinks(st)
  if (meta) {
    const tpl = String(meta.issueUrlTemplate || '')
    if (!tpl) return ''
    const refId = __refIdOf(st)
    if (!refId) return ''
    return tpl.split('{refId}').join(refId).split('{key}').join(n)
  }
  const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
  const bid = sel ? sel.backendId : null
  const leg = LEGACY_LINK_TEMPLATES[String(bid)]
  if (!leg) return ''
  const refId = __refIdOf(st)
  if (!refId || !refId.includes('/')) return ''
  return leg.issue.split('{refId}').join(refId).split('{key}').join(n)
}
export const searchUrlFor = (st, name) => {
  const n = String(name || '').trim()
  if (!n) return ''
  const meta = __metaLinks(st)
  if (meta) {
    const tpl = String(meta.searchUrlTemplate || '')
    if (!tpl) return ''
    return tpl.split('{q}').join(encodeURIComponent(n))
  }
  const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
  const leg = LEGACY_LINK_TEMPLATES[String(sel ? sel.backendId : null)]
  if (!leg) return ''
  return leg.search.split('{q}').join(encodeURIComponent(n))
}
export const repoUrlFor = (st) => {
  // 宿主 describe 产出的 url 是权威值：任何后端、只要给 url 就直用
  const repoFirst = st && (st.snapshot && (st.snapshot.repository || st.snapshot.repo))
  if (repoFirst && repoFirst.url) return repoFirst.url
  const meta = __metaLinks(st)
  if (meta) {
    const tpl = String(meta.repoUrlTemplate || '')
    if (!tpl) return ''
    const refId = __refIdOf(st)
    if (!refId) return ''
    return tpl.split('{refId}').join(refId)
  }
  const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
  const leg = LEGACY_LINK_TEMPLATES[String(sel ? sel.backendId : null)]
  if (!leg) return ''
  const refId = __refIdOf(st)
  if (!refId || !refId.includes('/')) return ''
  return leg.repo.split('{refId}').join(refId)
}
/**
 * 过渡期遗留映射（#231 清尾批删除）：仅覆盖快照尚未携带 links 元数据的窗口。
 * 形态与各后端模块声明完全一致；此处存在只为行为零回归，不是第二真源——真源在各模块。
 */
const LEGACY_LINK_TEMPLATES = {
  github: { issue: 'https://github.com/{refId}/issues/{key}', repo: 'https://github.com/{refId}', search: 'https://github.com/search?q={q}' },
  gitlab: { issue: 'https://gitlab.com/{refId}/-/issues/{key}', repo: 'https://gitlab.com/{refId}', search: 'https://gitlab.com/search?search={q}' },
}
