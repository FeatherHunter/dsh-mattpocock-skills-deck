/**
 * shared/tracker/link.js — 契约层 URL 供给纯函数（host + client 共用）。
 * 生效日期：2026-08-28（#227 D8 契约化 issueUrl/linkPattern）
 * 规则：github -> https://github.com/{refId}/issues/{key}
 *       gitlab -> https://gitlab.com/{refId}/-/issues/{key}
 *       markdown -> ''（无 URL，UI 不渲染）
 */

export function issueUrl(ref, key, backendId) {
  const k = String(key || '').trim()
  if (!k) return ''
  const bid = backendId || (ref && ref.backend) || 'github'
  const refId = ref && typeof ref.refId === 'string' ? ref.refId : ''
  if (!refId || !refId.includes('/')) return ''
  if (bid === 'markdown') return ''
  if (bid === 'gitlab') return 'https://gitlab.com/' + refId + '/-/issues/' + k
  // default github
  return 'https://github.com/' + refId + '/issues/' + k
}

export function searchUrl(name, backendId) {
  const n = String(name || '').trim()
  if (!n) return ''
  const bid = backendId || 'github'
  if (bid === 'gitlab') return 'https://gitlab.com/search?search=' + encodeURIComponent(n)
  if (bid === 'markdown') return ''
  return 'https://github.com/search?q=' + encodeURIComponent(n)
}

export function repoUrl(ref) {
  const refId = ref && typeof ref.refId === 'string' ? ref.refId : ''
  const bid = ref && ref.backend ? ref.backend : 'github'
  if (!refId || !refId.includes('/')) return ref && ref.url ? ref.url : ''
  if (bid === 'gitlab') return 'https://gitlab.com/' + refId
  if (bid === 'markdown') return ''
  return 'https://github.com/' + refId
}

export const LINK_PATTERNS = Object.freeze({
  github: /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g,
  gitlab: /gitlab\.com\/[^\/\s]+\/[^\/\s]+\/-\/issues\/(\d+)/g,
})

export function linkPatternFor(backendId) {
  if (backendId === 'gitlab') return LINK_PATTERNS.gitlab
  if (backendId === 'markdown') return null
  return LINK_PATTERNS.github
}
