/**
 * backends/github/preflight.js — 探测/登录/API 可达。
 *
 * ⌈ 骨架占位 ⌉ #114 实现：把现有 wf.status 的 GitHub 相关检查（gh CLI / gh 登录 /
 * API 可达 / tracker=GitHub）迁移到这里。
 */

import { BACKEND_KIND } from '../../../../shared/tracker/constants.js'

/**
 * @param {Object} ctx
 * @param {Object} [repo]
 * @returns {Promise<import('../../../../shared/tracker/shape.js').BackendStatus>}
 */
export async function ghPreflight(ctx, repo) {
  // TODO #114：探测 gh 路径 / auth status / api reachable
  return {
    backend: BACKEND_KIND.GITHUB,
    ok: false,
    capabilities: { labels: false, subIssue: false, depGraph: false, comments: false, closedState: false, liveUpdates: false, remoteSharing: false },
    detail: 'github preflight pending #114',
  }
}
export default ghPreflight
