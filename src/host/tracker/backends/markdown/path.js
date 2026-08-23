/**
 * backends/markdown/path.js — `.scratch/<feature-slug>/` 路径计算。
 *
 * ⌈ 骨架占位 ⌉ #115 实现：按设计契约 §5 计算 spec.md / map.md / issues/<NN>-<slug>.md。
 * 路径拼接必须经 platform/path（跨平台，杜绝反斜杠硬编码——#110 那类 bug）。
 */

/**
 * @param {import('../../../../shared/tracker/shape.js').RepositoryRef} repo
 * @param {string} kind 'spec' | 'map' | 'issue'
 * @param {string} [keyOrSlug]
 * @returns {string}
 */
export function mdPath(repo, kind, keyOrSlug) {
  // TODO #115：用 platform.path.join(repo.path, '.scratch', slug, ...)
  if (!repo.path) throw new Error('markdown path needs repo.path')
  const base = repo.path + (kind === 'issue' ? '/.scratch' : '')
  return base
}
export default mdPath
